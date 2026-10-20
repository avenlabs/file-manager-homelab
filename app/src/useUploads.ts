import { useCallback, useEffect, useRef, useState } from 'react';
import type { UploadTask } from 'expo-file-system';
import { createUpload, type Session } from './api';

export type UploadItem = {
  id: string;
  name: string;
  destDir: string;
  sent: number;
  total: number;
  status: 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';
  error?: string;
};

export type PickedFile = { uri: string; name: string; mimeType?: string; size?: number };

const CONCURRENCY = 2;

/** Antrian upload dengan progress; maksimal CONCURRENCY upload paralel. */
export function useUploads(session: Session, onFileDone: (destDir: string) => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const pending = useRef<{ id: string; file: PickedFile; destDir: string }[]>([]);
  const tasks = useRef(new Map<string, UploadTask>());
  const active = useRef(0);
  // pump memanggil dirinya lagi setelah upload selesai; lewat ref agar selalu versi terbaru.
  const pumpRef = useRef<() => void>(() => {});

  const patch = (id: string, p: Partial<UploadItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));

  const pump = useCallback(() => {
    while (active.current < CONCURRENCY && pending.current.length > 0) {
      const job = pending.current.shift()!;
      active.current++;
      const task = createUpload(session, job.file.uri, job.destDir, job.file.name, job.file.mimeType, (sent, total) =>
        patch(job.id, { sent, total: total > 0 ? total : job.file.size ?? 0 }),
      );
      tasks.current.set(job.id, task);
      patch(job.id, { status: 'uploading' });
      task
        .uploadAsync()
        .then((res) => {
          if (res.status >= 200 && res.status < 300) {
            patch(job.id, { status: 'done' });
            onFileDone(job.destDir);
          } else {
            let msg = `HTTP ${res.status}`;
            try {
              msg = JSON.parse(res.body).error ?? msg;
            } catch {}
            patch(job.id, { status: 'error', error: msg });
          }
        })
        .catch((e) =>
          patch(job.id, task.state === 'cancelled' ? { status: 'cancelled' } : { status: 'error', error: String(e?.message ?? e) }),
        )
        .finally(() => {
          tasks.current.delete(job.id);
          task.release();
          active.current--;
          pumpRef.current();
        });
    }
  }, [session, onFileDone]);

  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const enqueue = useCallback(
    (files: PickedFile[], destDir: string) => {
      const now = Date.now();
      const newItems = files.map((file, i) => ({
        id: `${now}-${i}-${file.name}`,
        name: file.name,
        destDir,
        sent: 0,
        total: file.size ?? 0,
        status: 'queued' as const,
      }));
      newItems.forEach((it, i) => pending.current.push({ id: it.id, file: files[i], destDir }));
      setItems((prev) => [...prev, ...newItems]);
      pump();
    },
    [pump],
  );

  const cancel = useCallback((id: string) => {
    const task = tasks.current.get(id);
    if (task) return task.cancel();
    pending.current = pending.current.filter((j) => j.id !== id);
    patch(id, { status: 'cancelled' });
  }, []);

  const clearFinished = useCallback(
    () => setItems((prev) => prev.filter((it) => it.status === 'queued' || it.status === 'uploading')),
    [],
  );

  return { items, enqueue, cancel, clearFinished };
}
