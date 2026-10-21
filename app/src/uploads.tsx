import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import * as Haptics from 'expo-haptics';
import { useUploads, type UploadSummary, type UploadTarget } from './useUploads';

type UploadsContextValue = ReturnType<typeof useUploads> & {
  /** Bertambah setiap ada file selesai; dipakai layar file untuk refresh folder tujuan. */
  lastDone: { sourceId: string; dir: string; n: number } | null;
};

const UploadsContext = createContext<UploadsContextValue | null>(null);

/** Antrian upload global: tetap berjalan walau user berpindah layar/sumber. */
export function UploadsProvider({ children }: { children: ReactNode }) {
  const [lastDone, setLastDone] = useState<UploadsContextValue['lastDone']>(null);
  const onFileDone = useCallback((target: UploadTarget) => {
    setLastDone((cur) => ({ sourceId: target.sourceId, dir: target.dir, n: (cur?.n ?? 0) + 1 }));
  }, []);
  const onSettled = useCallback((sum: UploadSummary) => {
    // Kegagalan ditampilkan lewat kartu peringatan di panel upload; di sini cukup getaran.
    const type = sum.failed.length ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success;
    if (sum.failed.length || sum.done || sum.skipped) Haptics.notificationAsync(type).catch(() => {});
  }, []);
  const uploads = useUploads(onFileDone, onSettled);
  const value = useMemo(() => ({ ...uploads, lastDone }), [uploads, lastDone]);
  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}

export function useUploadQueue() {
  const ctx = useContext(UploadsContext);
  if (!ctx) throw new Error('useUploadQueue harus dipakai di dalam UploadsProvider');
  return ctx;
}
