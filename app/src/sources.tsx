import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from './api';
import { storage } from './storage';
import type { ViewMode } from './screens/BrowserScreen';
import { CasaOSProvider } from './providers/casaos';
import { DeviceProvider } from './providers/device';
import { DropboxProvider } from './providers/dropbox';
import { GDriveProvider } from './providers/gdrive';
import { connectDropbox, connectGoogle, deleteTokens, saveTokens } from './providers/oauth';
import type { FileItem, SourceConfig, StorageProvider } from './providers/types';

const SOURCES_KEY = 'casa-files-sources';
const PREFS_KEY = 'casa-files-prefs';
const LEGACY_SESSION_KEY = 'casa-files-session';
const casaTokenKey = (id: string) => `casa-files-casaos-${id}`;

export const DEVICE_ID = 'device';

type Prefs = { view: ViewMode; showHidden: boolean };

/** Isi clipboard salin/pindah; bisa ditempel di sumber mana pun. */
export type Clipboard = { mode: 'copy' | 'move'; sourceId: string; fromFolder: string; items: FileItem[] };

type SourcesContextValue = {
  ready: boolean;
  sources: SourceConfig[];
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  provider: (id: string) => StorageProvider | null;
  addCasaOS: (session: Session) => Promise<string>;
  addGoogleDrive: () => Promise<string>;
  addDropbox: () => Promise<string>;
  removeSource: (id: string) => Promise<void>;
  clipboard: Clipboard | null;
  setClipboard: (c: Clipboard | null) => void;
};

const SourcesContext = createContext<SourcesContextValue | null>(null);

const deviceSource = (folders: { uri: string; name: string }[] = []): SourceConfig => ({
  id: DEVICE_ID,
  kind: 'device',
  label: 'HP ini',
  folders,
});

const newId = (kind: string) => `${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Daftar sumber penyimpanan (HP ini selalu ada) + token per sumber + preferensi tampilan.
 * Setiap orang menambah sumber sesuai kebutuhan: hanya HP, cloud, CasaOS, atau semuanya.
 */
export function SourcesProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [sources, setSources] = useState<SourceConfig[]>([deviceSource()]);
  const [casaTokens, setCasaTokens] = useState<Record<string, string>>({});
  const [prefs, setPrefsState] = useState<Prefs>({ view: 'list', showHidden: false });
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const sourcesRef = useRef(sources);
  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  const persist = useCallback((next: SourceConfig[]) => {
    setSources(next);
    sourcesRef.current = next;
    storage.set(SOURCES_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      let list: SourceConfig[] = [];
      try {
        const raw = await storage.get(SOURCES_KEY);
        if (raw) list = JSON.parse(raw);
      } catch {}
      const tokens: Record<string, string> = {};

      // Migrasi dari versi lama (satu login CasaOS).
      const legacy = await storage.get(LEGACY_SESSION_KEY).catch(() => null);
      if (legacy && !list.some((s) => s.kind === 'casaos')) {
        const s: Session = JSON.parse(legacy);
        const id = newId('casaos');
        list.push({ id, kind: 'casaos', label: 'CasaOS', baseUrl: s.baseUrl });
        await storage.set(casaTokenKey(id), s.token);
        await storage.remove(LEGACY_SESSION_KEY);
      }
      if (!list.some((s) => s.kind === 'device')) list.unshift(deviceSource());

      for (const s of list) {
        if (s.kind === 'casaos') tokens[s.id] = (await storage.get(casaTokenKey(s.id)).catch(() => null)) ?? '';
      }
      const p = await storage.get(PREFS_KEY).catch(() => null);
      if (p) setPrefsState((cur) => ({ ...cur, ...JSON.parse(p) }));
      setCasaTokens(tokens);
      persist(list);
      setReady(true);
    })();
  }, [persist]);

  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((cur) => {
      const next = { ...cur, ...p };
      storage.set(PREFS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  // Instance provider di-cache per konfigurasi agar token & sesi upload tetap hidup antar layar.
  const cache = useRef(new Map<string, { key: string; provider: StorageProvider }>());
  const provider = useCallback(
    (id: string): StorageProvider | null => {
      const cfg = sources.find((s) => s.id === id);
      if (!cfg) return null;
      const key = JSON.stringify(cfg) + (cfg.kind === 'casaos' ? casaTokens[id] : '');
      const hit = cache.current.get(id);
      if (hit?.key === key) return hit.provider;
      let p: StorageProvider;
      switch (cfg.kind) {
        case 'device':
          p = new DeviceProvider(cfg.id, cfg.label, cfg.folders, (folders) =>
            persist(sourcesRef.current.map((s) => (s.id === cfg.id ? { ...cfg, folders } : s))),
          );
          break;
        case 'casaos':
          p = new CasaOSProvider(cfg.id, cfg.label, { baseUrl: cfg.baseUrl, token: casaTokens[id] ?? '' });
          break;
        case 'gdrive':
          p = new GDriveProvider(cfg.id, cfg.label, cfg.email ?? 'Google Drive');
          break;
        case 'dropbox':
          p = new DropboxProvider(cfg.id, cfg.label, cfg.email ?? 'Dropbox');
          break;
      }
      cache.current.set(id, { key, provider: p });
      return p;
    },
    [sources, casaTokens, persist],
  );

  const addCasaOS = useCallback(
    async (session: Session) => {
      // Server yang sama → perbarui token saja.
      const existing = sourcesRef.current.find((s) => s.kind === 'casaos' && s.baseUrl === session.baseUrl);
      const id = existing?.id ?? newId('casaos');
      await storage.set(casaTokenKey(id), session.token);
      setCasaTokens((cur) => ({ ...cur, [id]: session.token }));
      if (!existing) {
        const n = sourcesRef.current.filter((s) => s.kind === 'casaos').length;
        persist([...sourcesRef.current, { id, kind: 'casaos', label: n ? `CasaOS ${n + 1}` : 'CasaOS', baseUrl: session.baseUrl }]);
      }
      return id;
    },
    [persist],
  );

  const addOAuth = useCallback(
    async (kind: 'gdrive' | 'dropbox') => {
      const { tokens, email } = kind === 'gdrive' ? await connectGoogle() : await connectDropbox();
      const existing = sourcesRef.current.find((s) => s.kind === kind && 'email' in s && s.email === email);
      const id = existing?.id ?? newId(kind);
      await saveTokens(id, tokens);
      cache.current.delete(id);
      if (!existing) {
        const label = kind === 'gdrive' ? 'Google Drive' : 'Dropbox';
        persist([...sourcesRef.current, { id, kind, label, email }]);
      } else {
        persist([...sourcesRef.current]);
      }
      return id;
    },
    [persist],
  );

  const removeSource = useCallback(
    async (id: string) => {
      if (id === DEVICE_ID) return;
      await storage.remove(casaTokenKey(id)).catch(() => {});
      await deleteTokens(id).catch(() => {});
      cache.current.delete(id);
      persist(sourcesRef.current.filter((s) => s.id !== id));
      setClipboard((c) => (c?.sourceId === id ? null : c));
    },
    [persist],
  );

  const value = useMemo(
    () => ({
      ready,
      sources,
      prefs,
      setPrefs,
      provider,
      addCasaOS,
      addGoogleDrive: () => addOAuth('gdrive'),
      addDropbox: () => addOAuth('dropbox'),
      removeSource,
      clipboard,
      setClipboard,
    }),
    [ready, sources, prefs, setPrefs, provider, addCasaOS, addOAuth, removeSource, clipboard],
  );
  return <SourcesContext.Provider value={value}>{children}</SourcesContext.Provider>;
}

export function useSources() {
  const ctx = useContext(SourcesContext);
  if (!ctx) throw new Error('useSources harus dipakai di dalam SourcesProvider');
  return ctx;
}
