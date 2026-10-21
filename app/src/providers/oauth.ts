import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import {
  AuthRequest,
  exchangeCodeAsync,
  makeRedirectUri,
  refreshAsync,
  ResponseType,
  type DiscoveryDocument,
  type TokenResponse,
} from 'expo-auth-session';
import { storage } from '../storage';

WebBrowser.maybeCompleteAuthSession();

// Kredensial OAuth diisi lewat environment saat build (lihat docs/cloud-setup.md).
export const oauthConfig = {
  google: {
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? '',
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
  },
  dropbox: { appKey: process.env.EXPO_PUBLIC_DROPBOX_APP_KEY ?? '' },
};

const googleDiscovery: DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

const dropboxDiscovery: DiscoveryDocument = {
  authorizationEndpoint: 'https://www.dropbox.com/oauth2/authorize',
  tokenEndpoint: 'https://api.dropboxapi.com/oauth2/token',
};

export type Tokens = { accessToken: string; refreshToken?: string; expiresAt: number };

const fromResponse = (r: TokenResponse, prev?: Tokens): Tokens => ({
  accessToken: r.accessToken,
  refreshToken: r.refreshToken ?? prev?.refreshToken,
  expiresAt: Date.now() + (r.expiresIn ?? 3600) * 1000,
});

/** Client ID Google untuk platform ini + redirect URI yang cocok. */
function googleClient(): { clientId: string; redirectUri: string } {
  const g = oauthConfig.google;
  if (Platform.OS === 'web') return { clientId: g.webClientId, redirectUri: makeRedirectUri() };
  // iOS & Android memakai skema "reversed client ID" (com.googleusercontent.apps.xxx:/oauthredirect).
  const clientId = (Platform.OS === 'android' ? g.androidClientId : '') || g.iosClientId;
  const reversed = clientId.split('.').reverse().join('.');
  return { clientId, redirectUri: `${reversed}:/oauthredirect` };
}

const dropboxRedirect = () => makeRedirectUri({ scheme: 'casafiles', path: 'oauth/dropbox' });

export const isGoogleConfigured = () => !!googleClient().clientId;
export const isDropboxConfigured = () => !!oauthConfig.dropbox.appKey;

async function authorize(
  discovery: DiscoveryDocument,
  clientId: string,
  redirectUri: string,
  scopes: string[],
  extraParams: Record<string, string>,
): Promise<Tokens> {
  const request = new AuthRequest({
    clientId,
    redirectUri,
    scopes,
    responseType: ResponseType.Code,
    usePKCE: true,
    extraParams,
  });
  const result = await request.promptAsync(discovery);
  if (result.type === 'cancel' || result.type === 'dismiss') throw new Error('Login dibatalkan');
  if (result.type !== 'success') {
    const err = result.type === 'error' ? result.error?.description || result.error?.message : null;
    throw new Error(err || 'Login gagal');
  }
  const token = await exchangeCodeAsync(
    { clientId, redirectUri, code: result.params.code, extraParams: { code_verifier: request.codeVerifier ?? '' } },
    discovery,
  );
  return fromResponse(token);
}

export async function connectGoogle(): Promise<{ tokens: Tokens; email?: string }> {
  const { clientId, redirectUri } = googleClient();
  if (!clientId) throw new Error('Google Drive belum dikonfigurasi di build ini (lihat docs/cloud-setup.md).');
  const tokens = await authorize(
    googleDiscovery,
    clientId,
    redirectUri,
    ['openid', 'email', 'https://www.googleapis.com/auth/drive'],
    // offline + consent agar Google mengirim refresh token.
    { access_type: 'offline', prompt: 'consent' },
  );
  const me = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  })
    .then((r) => r.json())
    .catch(() => null);
  return { tokens, email: me?.email };
}

export async function connectDropbox(): Promise<{ tokens: Tokens; email?: string }> {
  const appKey = oauthConfig.dropbox.appKey;
  if (!appKey) throw new Error('Dropbox belum dikonfigurasi di build ini (lihat docs/cloud-setup.md).');
  const tokens = await authorize(dropboxDiscovery, appKey, dropboxRedirect(), [], { token_access_type: 'offline' });
  const me = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  })
    .then((r) => r.json())
    .catch(() => null);
  return { tokens, email: me?.email };
}

const tokenKey = (sourceId: string) => `casa-files-token-${sourceId}`;

export async function saveTokens(sourceId: string, tokens: Tokens) {
  await storage.set(tokenKey(sourceId), JSON.stringify(tokens));
}

export async function deleteTokens(sourceId: string) {
  await storage.remove(tokenKey(sourceId));
}

/**
 * Access token yang selalu segar: diperbarui otomatis dengan refresh token saat hampir kedaluwarsa.
 * Refresh paralel digabung menjadi satu permintaan.
 */
export class TokenManager {
  private tokens: Tokens | null = null;
  private refreshing: Promise<Tokens> | null = null;

  constructor(
    private sourceId: string,
    private provider: 'google' | 'dropbox',
  ) {}

  async accessToken(): Promise<string> {
    if (!this.tokens) {
      const raw = await storage.get(tokenKey(this.sourceId));
      if (!raw) throw new AuthExpiredError();
      this.tokens = JSON.parse(raw);
    }
    if (this.tokens!.expiresAt - Date.now() > 60_000) return this.tokens!.accessToken;
    return (await this.refresh()).accessToken;
  }

  /** Paksa refresh (mis. setelah respons 401). */
  refresh(): Promise<Tokens> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => (this.refreshing = null));
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<Tokens> {
    const current = this.tokens;
    if (!current?.refreshToken) throw new AuthExpiredError();
    const clientId = this.provider === 'google' ? googleClient().clientId : oauthConfig.dropbox.appKey;
    const discovery = this.provider === 'google' ? googleDiscovery : dropboxDiscovery;
    try {
      const res = await refreshAsync({ clientId, refreshToken: current.refreshToken }, discovery);
      this.tokens = fromResponse(res, current);
      await saveTokens(this.sourceId, this.tokens);
      return this.tokens;
    } catch (e: any) {
      if (/invalid_grant|revoked|expired/i.test(String(e?.message ?? e))) throw new AuthExpiredError();
      throw e;
    }
  }
}

export class AuthExpiredError extends Error {
  constructor() {
    super('Akses ke akun ini sudah tidak berlaku. Hubungkan ulang lewat Beranda → Tambah sumber.');
  }
}
