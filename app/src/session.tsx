import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from './api';
import { storage } from './storage';
import type { ViewMode } from './screens/BrowserScreen';

const SESSION_KEY = 'casa-files-session';
const PREFS_KEY = 'casa-files-prefs';

type Prefs = { view: ViewMode; showHidden: boolean };

type SessionContextValue = {
  ready: boolean;
  session: Session | null;
  prefs: Prefs;
  signIn: (s: Session) => Promise<void>;
  signOut: () => Promise<void>;
  setPrefs: (p: Partial<Prefs>) => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

/** Menyimpan session login (SecureStore/localStorage) dan preferensi tampilan. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>({ view: 'list', showHidden: false });

  useEffect(() => {
    Promise.all([storage.get(SESSION_KEY), storage.get(PREFS_KEY)])
      .then(([s, p]) => {
        if (s) setSession(JSON.parse(s));
        if (p) setPrefsState((cur) => ({ ...cur, ...JSON.parse(p) }));
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const signIn = useCallback(async (s: Session) => {
    await storage.set(SESSION_KEY, JSON.stringify(s));
    setSession(s);
  }, []);

  const signOut = useCallback(async () => {
    await storage.remove(SESSION_KEY);
    setSession(null);
  }, []);

  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((cur) => {
      const next = { ...cur, ...p };
      storage.set(PREFS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ ready, session, prefs, signIn, signOut, setPrefs }),
    [ready, session, prefs, signIn, signOut, setPrefs],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession harus dipakai di dalam SessionProvider');
  return ctx;
}

/** Untuk layar yang hanya bisa diakses setelah login (dijamin oleh Stack.Protected). */
export function useAuthedSession(): Session {
  const { session } = useSession();
  if (!session) throw new Error('Belum login');
  return session;
}
