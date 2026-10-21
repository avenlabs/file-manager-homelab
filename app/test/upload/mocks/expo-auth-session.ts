// Hanya refreshAsync yang dipakai tes (token kedaluwarsa → refresh).
export const ResponseType = { Code: 'code' };
export class AuthRequest {}
export const makeRedirectUri = () => 'casafiles://oauth';
export const exchangeCodeAsync = async () => { throw new Error('tidak dipakai di tes'); };
export const refreshAsync = async (cfg: { refreshToken: string }) => {
  (globalThis as any).__REFRESHED__ = ((globalThis as any).__REFRESHED__ ?? 0) + 1;
  return { accessToken: 'token-baru', expiresIn: 3600, refreshToken: cfg.refreshToken };
};
