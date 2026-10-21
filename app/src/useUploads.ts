import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Directory, File, Paths, type UploadTask } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { networkReason, UploadError } from './api';
import type { UploadAdapter } from './providers/types';

export type UploadStatus = 'queued' | 'uploading' | 'retrying' | 'done' | 'skipped' | 'error' | 'cancelled';

export type UploadItem = {
  id: string;
  name: string;
  destDir: string;
  /** Nama tujuan untuk ditampilkan, mis. "Google Drive / Foto". */
  destLabel: string;
  size: number;
  sent: number;
  status: UploadStatus;
  /** Alasan gagal, atau alasan percobaan ulang saat status 'retrying'. */
  error?: string;
  attempt?: number;
};

export type PickedFile = {
  /** URI lokal. Boleh kosong jika `prepare` dipakai. */
  uri?: string;
  name: string;
  mimeType?: string;
  size?: number;
  modTime?: number;
  /** Ambil file ke lokal dulu (mis. unduh dari sumber lain saat salin antar sumber). */
  prepare?: () => Promise<{ uri: string; size?: number }>;
  /** Dijalankan setelah sukses (mis. hapus file asal saat "pindah" antar sumber). */
  after?: () => Promise<void>;
};

/** Tujuan upload: adapter milik sumber + folder tujuan di sumber itu. */
export type UploadTarget = { sourceId: string; adapter: UploadAdapter; dir: string; label: string };

export type UploadSummary = { total: number; done: number; skipped: number; failed: UploadItem[]; cancelled: number };

const CONCURRENCY = 2;
/** Ukuran potongan. Jika satu potongan gagal, hanya potongan ini yang diulang. */
const CHUNK_BYTES = 16 * 1024 * 1024;
/** Potongan dibatalkan & diulang jika tidak ada progres selama ini. */
const STALL_MS = 45_000;
/** Percobaan ulang beruntun tanpa progres sebelum file dilewati. */
const MAX_RETRIES = 5;
const BACKOFF_MS = [2_000, 4_000, 8_000, 15_000, 30_000];
const KEEP_AWAKE_TAG = 'casa-files-upload';

const RUNNING: UploadStatus[] = ['queued', 'uploading', 'retrying'];

type Job = {
  id: string;
  file: PickedFile;
  target: UploadTarget;
  /** URI lokal hasil `prepare` (file sementara, dihapus setelah selesai). */
  prepared?: { uri: string; size?: number };
  cancelled: boolean;
  task?: UploadTask;
  sessionId?: string;
  wake?: () => void;
};

class CancelledError extends Error {}

function summarize(items: UploadItem[]): UploadSummary {
  return {
    total: items.length,
    done: items.filter((i) => i.status === 'done').length,
    skipped: items.filter((i) => i.status === 'skipped').length,
    failed: items.filter((i) => i.status === 'error'),
    cancelled: items.filter((i) => i.status === 'cancelled').length,
  };
}

/** Hapus file sementara hasil `prepare` (hanya yang ada di folder cache). */
function cleanup(job: Job) {
  if (!job.prepared) return;
  try {
    const f = new File(job.prepared.uri);
    if (f.exists && f.uri.includes('/cache')) f.delete();
  } catch {}
}

const chunkDir = () => {
  const dir = new Directory(Paths.cache, 'upload-chunks');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
};

/**
 * Antrian upload resumable.
 * - File dikirim per potongan 16MB; kalau koneksi putus, lanjut dari byte terakhir yang diterima server.
 * - Potongan yang macet (tanpa progres 45 detik) dibatalkan lalu dicoba ulang dengan jeda bertahap.
 * - Setelah 5x gagal beruntun, file ditandai gagal (dengan alasan) dan antrian lanjut ke file berikutnya.
 * - File yang sudah ada di server (nama & ukuran sama) dilewati, jadi aman memilih ulang file yang sama.
 */
export function useUploads(
  onFileDone?: (target: UploadTarget) => void,
  onSettled?: (summary: UploadSummary) => void,
) {
  const [items, setItems] = useState<UploadItem[]>([]);
  // Salinan sinkron dari `items`, agar ringkasan akhir batch selalu akurat walau render digabung.
  const itemsRef = useRef<UploadItem[]>([]);
  const batchOpen = useRef(false);
  const pending = useRef<Job[]>([]);
  const jobs = useRef(new Map<string, Job>());
  const active = useRef(0);
  const pumpRef = useRef<() => void>(() => {});
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);

  const commit = useCallback((next: UploadItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const patch = useCallback(
    (id: string, p: Partial<UploadItem>) => commit(itemsRef.current.map((it) => (it.id === id ? { ...it, ...p } : it))),
    [commit],
  );

  const sleep = (job: Job, ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      job.wake = () => {
        clearTimeout(t);
        resolve();
      };
    });

  /** Kirim satu potongan mulai `offset`; mengembalikan offset baru menurut server. */
  const sendChunk = useCallback(
    async (job: Job, local: File, id: string, offset: number, size: number): Promise<number> => {
      const len = Math.min(CHUNK_BYTES, size - offset);
      let src = local;
      let tmp: File | null = null;
      if (!(offset === 0 && len === size)) {
        // File besar: salin potongan ke file sementara agar bisa dikirim oleh upload native.
        try {
          tmp = new File(chunkDir(), `${job.id}.chunk`);
          if (tmp.exists) tmp.delete();
          tmp.create();
          const handle = local.open();
          try {
            handle.offset = offset;
            await tmp.write(await handle.readBytes(len));
          } finally {
            handle.close();
          }
          src = tmp;
        } catch (e: any) {
          tmp?.exists && tmp.delete();
          throw new UploadError(`File di HP tidak bisa dibaca: ${e?.message ?? 'tanpa keterangan'}`, true);
        }
      }

      let lastProgress = Date.now();
      let stalled = false;
      let created: Awaited<ReturnType<UploadAdapter['chunk']>>;
      try {
        created = await job.target.adapter.chunk(id, offset, len, size, src, (sent) => {
          lastProgress = Date.now();
          patch(job.id, { sent: offset + Math.min(sent, len), status: 'uploading', error: undefined });
        });
      } catch (e) {
        if (tmp?.exists) tmp.delete();
        throw e instanceof UploadError ? e : new UploadError(networkReason(e));
      }
      const { task, parse } = created;
      job.task = task;
      const watchdog = setInterval(() => {
        if (Date.now() - lastProgress > STALL_MS) {
          stalled = true;
          task.cancel();
        }
      }, 3_000);

      try {
        return parse(await task.uploadAsync());
      } catch (e) {
        if (job.cancelled) throw new CancelledError();
        if (stalled) throw new UploadError(`Koneksi macet, tidak ada progres selama ${STALL_MS / 1000} detik`);
        if (e instanceof UploadError) throw e;
        throw new UploadError(networkReason(e));
      } finally {
        clearInterval(watchdog);
        job.task = undefined;
        task.release();
        if (tmp?.exists) tmp.delete();
      }
    },
    [patch],
  );

  /** Upload satu file sampai selesai, dilewati, atau gagal permanen. */
  const runJob = useCallback(
    async (job: Job): Promise<'done' | 'skipped'> => {
      if (Platform.OS === 'web') throw new UploadError('Upload hanya tersedia di app iPhone / Android', true);
      const { adapter, dir } = job.target;

      // Salin antar sumber: ambil file dari sumber asal ke lokal dulu (dengan retry).
      if (job.file.prepare && !job.prepared) {
        for (let attempt = 1; ; attempt++) {
          if (job.cancelled) throw new CancelledError();
          try {
            job.prepared = await job.file.prepare();
            break;
          } catch (e: any) {
            const msg = `Gagal mengambil file dari sumber asal: ${e?.message ?? 'tanpa keterangan'}`;
            if (attempt > MAX_RETRIES) throw new UploadError(`${msg} — sudah dicoba ${MAX_RETRIES}x`, true);
            patch(job.id, { status: 'retrying', error: msg, attempt });
            await sleep(job, BACKOFF_MS[attempt - 1]);
          }
        }
      }
      const uri = job.prepared?.uri ?? job.file.uri;
      if (!uri) throw new UploadError('File tidak punya lokasi lokal', true);

      let local: File;
      let size: number;
      try {
        local = new File(uri);
        if (!local.exists) throw new UploadError('File di HP tidak ditemukan (mungkin sudah dihapus atau dipindah)', true);
        size = job.prepared?.size || job.file.size || local.size;
      } catch (e) {
        if (e instanceof UploadError) throw e;
        throw new UploadError(`File di HP tidak bisa dibaca (${(e as any)?.message ?? 'tanpa keterangan'})`, true);
      }
      patch(job.id, { size, status: 'uploading' });

      // Tujuan lokal (HP ini): salin langsung tanpa jaringan.
      if (adapter.direct) {
        try {
          const r = await adapter.direct(uri, dir, job.file.name, size);
          patch(job.id, { sent: size });
          return r;
        } catch (e: any) {
          throw new UploadError(`Gagal menyimpan di HP: ${e?.message ?? 'tanpa keterangan'}`, true);
        }
      }

      let failures = 0;
      for (;;) {
        if (job.cancelled) throw new CancelledError();
        try {
          const init = await adapter.init(dir, job.file.name, size, job.file.modTime);
          if (init.status === 'exists') {
            patch(job.id, { sent: size });
            return 'skipped';
          }
          job.sessionId = init.session;
          let offset = init.offset;
          patch(job.id, { sent: offset });
          while (offset < size) {
            if (job.cancelled) throw new CancelledError();
            const next = await sendChunk(job, local, init.session, offset, size);
            if (next <= offset) throw new UploadError('Server tidak menerima data potongan');
            failures = 0; // ada kemajuan → reset hitungan gagal
            offset = next;
          }
          if ((await adapter.complete(init.session, size)) === 'done') return 'done';
          // 'retry': respons complete sebelumnya hilang / belum lengkap → init ulang (idempotent).
        } catch (e) {
          if (e instanceof CancelledError || job.cancelled) throw new CancelledError();
          const err = e instanceof UploadError ? e : new UploadError(`Kesalahan tak terduga: ${(e as any)?.message ?? 'tanpa keterangan'}`);
          if (err.fatal) throw err;
          failures += 1;
          if (failures > MAX_RETRIES) {
            throw new UploadError(`${err.message} — sudah dicoba ${MAX_RETRIES}x`, true);
          }
          patch(job.id, { status: 'retrying', error: err.message, attempt: failures });
          await sleep(job, BACKOFF_MS[failures - 1]);
        }
      }
    },
    [patch, sendChunk],
  );



  const pump = useCallback(() => {
    while (active.current < CONCURRENCY && pending.current.length > 0) {
      const job = pending.current.shift()!;
      if (job.cancelled) continue;
      active.current++;
      runJob(job)
        .then(async (result) => {
          if (job.file.after) {
            try {
              await job.file.after();
            } catch (e: any) {
              // File sudah tersalin; hanya penghapusan file asal yang gagal.
              patch(job.id, { status: 'error', error: `Tersalin, tapi file asal gagal dihapus: ${e?.message ?? 'tanpa keterangan'}` });
              return;
            }
          }
          cleanup(job);
          patch(job.id, { status: result, error: undefined });
          if (result === 'done') onFileDone?.(job.target);
        })
        .catch((e) => {
          if (e instanceof CancelledError || job.cancelled) {
            cleanup(job);
            patch(job.id, { status: 'cancelled', error: undefined });
            if (job.sessionId) job.target.adapter.abort?.(job.sessionId).catch(() => {});
          } else {
            const msg = String(e?.message ?? '').trim();
            patch(job.id, { status: 'error', error: msg || 'Gagal tanpa keterangan' });
          }
        })
        .finally(() => {
          // File sementara dari `prepare` disimpan saat gagal agar "Coba lagi" tidak perlu unduh ulang.
          active.current--;
          pumpRef.current();
        });
    }
    // Antrian kosong → batch selesai: kirim ringkasan sekali.
    if (batchOpen.current && active.current === 0 && pending.current.length === 0) {
      batchOpen.current = false;
      settledRef.current?.(summarize(itemsRef.current));
    }
  }, [runJob, patch, onFileDone]);

  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const enqueue = useCallback(
    (files: PickedFile[], target: UploadTarget) => {
      const now = Date.now();
      const newItems: UploadItem[] = files.map((file, i) => ({
        id: `${now}-${i}-${file.name}`,
        name: file.name,
        destDir: target.dir,
        destLabel: target.label,
        size: file.size ?? 0,
        sent: 0,
        status: 'queued',
      }));
      newItems.forEach((it, i) => {
        const job: Job = { id: it.id, file: files[i], target, cancelled: false };
        jobs.current.set(it.id, job);
        pending.current.push(job);
      });
      if (!files.length) return;
      // Item yang gagal tetap ditampilkan sampai di-retry atau ditutup.
      commit([...itemsRef.current.filter((p) => RUNNING.includes(p.status) || p.status === 'error'), ...newItems]);
      batchOpen.current = true;
      pump();
    },
    [pump, commit],
  );

  const cancel = useCallback(
    (id: string) => {
      const job = jobs.current.get(id);
      if (!job) return;
      job.cancelled = true;
      job.task?.cancel();
      job.wake?.();
      if (!job.task) patch(id, { status: 'cancelled', error: undefined });
    },
    [patch],
  );

  const cancelAll = useCallback(() => {
    itemsRef.current.filter((i) => RUNNING.includes(i.status)).forEach((i) => cancel(i.id));
  }, [cancel]);

  /** Masukkan ulang semua file yang gagal ke antrian (melanjutkan dari byte terakhir di server). */
  const retryFailed = useCallback(() => {
    const failed = itemsRef.current.filter((i) => i.status === 'error');
    if (!failed.length) return;
    for (const it of failed) {
      const old = jobs.current.get(it.id);
      if (!old) continue;
      const job: Job = { id: it.id, file: old.file, target: old.target, prepared: old.prepared, cancelled: false };
      jobs.current.set(it.id, job);
      pending.current.push(job);
    }
    commit(
      itemsRef.current.map((p) => (p.status === 'error' ? { ...p, status: 'queued', error: undefined, attempt: undefined } : p)),
    );
    batchOpen.current = true;
    pump();
  }, [pump, commit]);

  const clearFinished = useCallback(() => {
    commit(itemsRef.current.filter((it) => RUNNING.includes(it.status)));
  }, [commit]);

  const running = items.some((i) => RUNNING.includes(i.status));

  // Layar tetap menyala selama upload, agar upload besar tidak terhenti saat HP terkunci.
  useEffect(() => {
    if (!running) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [running]);

  const summary = useMemo(() => summarize(items), [items]);

  return { items, summary, running, enqueue, cancel, cancelAll, retryFailed, clearFinished };
}
