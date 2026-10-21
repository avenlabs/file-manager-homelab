import { File, UploadTask, UploadType } from 'expo-file-system';
import type { FlagColor } from './theme';

export type Entry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modTime: string;
  mime?: string;
  flag?: FlagColor;
};

export type Session = { baseUrl: string; token: string };

export type StorageInfo = { total: number; free: number; used: number };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function normalizeBaseUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url;
}

async function request<T>(s: Session, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${s.baseUrl}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${s.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** fetch dengan batas waktu, agar alamat yang salah tidak menggantung lama. */
async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cek server lalu login. Pesan error dibuat jelas untuk kesalahan umum:
 * server tidak terjangkau, alamat menunjuk ke dashboard CasaOS, atau password salah.
 */
export async function login(baseUrl: string, password: string): Promise<Session> {
  let health: Response;
  try {
    health = await fetchWithTimeout(`${baseUrl}/api/health`);
  } catch {
    throw new Error(
      `Tidak bisa terhubung ke ${baseUrl}. Pastikan server casa-files sudah terinstall & berjalan, ` +
        'dan HP satu Wi-Fi dengan server (atau Tailscale aktif).',
    );
  }
  const status = await health.json().catch(() => null);
  if (!health.ok || status?.status !== 'ok') {
    throw new Error(
      'Alamat ini bukan server Casa Files (mungkin dashboard CasaOS). ' +
        'Gunakan port server casa-files, biasanya :8088.',
    );
  }

  const res = await fetchWithTimeout(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    throw new ApiError(401, 'Password salah. Gunakan password yang dibuat saat install server (bukan password CasaOS).');
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
  return { baseUrl, token: data.token };
}

export const listDir = (s: Session, path: string, hidden = false) =>
  request<{ path: string; entries: Entry[] }>(
    s,
    'GET',
    `/list?path=${encodeURIComponent(path)}${hidden ? '&hidden=1' : ''}`,
  );

export const storageInfo = (s: Session) => request<StorageInfo>(s, 'GET', '/storage');

export const mkdir = (s: Session, path: string) => request(s, 'POST', '/mkdir', { path });

export const rename = (s: Session, from: string, to: string) =>
  request(s, 'POST', '/rename', { from, to });

export type BatchResult = { from: string; to?: string; error?: string };

/** Jalankan operasi batch; lempar error berisi ringkasan jika ada item yang gagal. */
async function batch(s: Session, path: string, body: unknown): Promise<BatchResult[]> {
  const { results } = await request<{ results: BatchResult[] }>(s, 'POST', path, body);
  const failed = results.filter((r) => r.error);
  if (failed.length) {
    const name = (p: string) => p.split('/').pop();
    throw new Error(failed.map((f) => `${name(f.from)}: ${f.error}`).join('\n'));
  }
  return results;
}

export const copyItems = (s: Session, paths: string[], dest: string) => batch(s, '/copy', { paths, dest });
export const moveItems = (s: Session, paths: string[], dest: string) => batch(s, '/move', { paths, dest });
export const deleteItems = (s: Session, paths: string[]) => batch(s, '/delete', { paths });
export const setFlag = (s: Session, paths: string[], color: FlagColor | null) =>
  request(s, 'POST', '/flag', { paths, color: color ?? '' });

export type SizeCount = { key: string; size: number; count: number };

export type Stats = {
  computedAt: string;
  durationMs: number;
  disk: StorageInfo;
  location: { root: string; mountPoint?: string; fsType?: string; device?: string };
  server: {
    hostname: string;
    os: string;
    arch: string;
    version: string;
    goVersion: string;
    uptimeSeconds: number;
    hostUptimeSeconds?: number;
  };
  files: number;
  folders: number;
  totalSize: number;
  flagged: number;
  categories: SizeCount[];
  extensions: SizeCount[];
  largest: Entry[];
  recent: Entry[];
};

export const getStats = (s: Session, refresh = false) =>
  request<Stats>(s, 'GET', `/stats${refresh ? '?refresh=1' : ''}`);

export const remove = (s: Session, path: string) =>
  request(s, 'DELETE', `/delete?path=${encodeURIComponent(path)}`);

/** URL file dengan token di query, untuk <Image>, <VideoView> dan download. */
export function fileUrl(s: Session, path: string, download = false): string {
  const q = `path=${encodeURIComponent(path)}&token=${encodeURIComponent(s.token)}`;
  return `${s.baseUrl}/api/file?${q}${download ? '&download=1' : ''}`;
}

// ---------- upload resumable (lihat server/uploads.go) ----------

/** Error upload. `fatal` = tidak ada gunanya dicoba ulang (mis. disk penuh, file hilang). */
export class UploadError extends Error {
  constructor(
    message: string,
    public fatal = false,
  ) {
    super(message);
  }
}

/** Ubah respons gagal menjadi alasan yang bisa dibaca manusia. */
export function uploadErrorFrom(status: number, body: { error?: string; code?: string } | null): UploadError {
  const detail = body?.error?.trim();
  if (status === 507 || body?.code === 'no_space') return new UploadError(detail || 'Storage server penuh', true);
  if (status === 401) return new UploadError('Sesi login berakhir. Silakan login ulang.', true);
  if (status === 400 && !detail) return new UploadError('Permintaan ditolak server (data tidak valid)', true);
  if (status === 404) return new UploadError(detail || 'Sesi upload hilang di server');
  if (status >= 500) return new UploadError(`Server error ${status}${detail ? `: ${detail}` : ' (tanpa keterangan)'}`);
  return new UploadError(detail || `Gagal tanpa keterangan dari server (HTTP ${status})`);
}

/** Alasan untuk error jaringan (fetch/upload task gagal tanpa respons). */
export function networkReason(e: unknown): string {
  const msg = String((e as any)?.message ?? e ?? '').toLowerCase();
  if (msg.includes('abort') || msg.includes('timeout') || msg.includes('timed out')) return 'Server tidak merespons (timeout)';
  if (msg.includes('offline') || msg.includes('internet')) return 'HP sedang offline';
  if (msg.includes('network') || msg.includes('connect') || msg.includes('host') || msg.includes('reset'))
    return 'Koneksi ke server terputus';
  return msg ? `Kesalahan jaringan: ${(e as any)?.message ?? e}` : 'Kesalahan jaringan tanpa keterangan';
}

async function uploadRequest<T>(s: Session, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${s.baseUrl}/api${path}`,
      {
        method,
        headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      },
      20000,
    );
  } catch (e) {
    throw new UploadError(networkReason(e));
  }
  const data = await res.json().catch(() => null);
  return { status: res.status, data: data as T };
}

export type UploadInit = { status: 'exists'; path: string } | { status: 'upload'; id: string; offset: number; size: number };

export async function initUpload(s: Session, dir: string, name: string, size: number, modTime?: number) {
  const { status, data } = await uploadRequest<UploadInit & { error?: string; code?: string }>(s, 'POST', '/uploads', {
    dir,
    name,
    size,
    ...(modTime ? { modTime: new Date(modTime).toISOString() } : {}),
  });
  if (status !== 200) throw uploadErrorFrom(status, data);
  return data;
}

/** Selesaikan upload. Mengembalikan 'retry' jika sesi perlu di-init ulang (mis. respons sebelumnya hilang). */
export async function completeUpload(s: Session, id: string): Promise<'done' | 'retry'> {
  const { status, data } = await uploadRequest<{ error?: string; code?: string }>(s, 'POST', `/uploads/${id}/complete`);
  if (status === 200) return 'done';
  if (status === 404 || status === 409) return 'retry';
  throw uploadErrorFrom(status, data);
}

export async function abortUpload(s: Session, id: string) {
  await uploadRequest(s, 'DELETE', `/uploads/${id}`).catch(() => {});
}

/** Task untuk mengirim satu potongan file (PUT byte mentah) mulai dari `offset`. */
export function createChunkTask(
  s: Session,
  id: string,
  offset: number,
  chunk: File,
  onProgress: (bytesSent: number) => void,
): UploadTask {
  return chunk.createUploadTask(`${s.baseUrl}/api/uploads/${id}?offset=${offset}`, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/octet-stream' },
    // Tetap jalan saat app di-minimize.
    sessionType: 'background',
    onProgress: ({ bytesSent }) => onProgress(bytesSent),
  });
}

export function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`;
}

export function parentPath(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}


export function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} hari ${h} jam`;
  if (h) return `${h} jam ${m} mnt`;
  return `${m} mnt`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Ukuran untuk tampilan; ukuran tidak diketahui (mis. foto di galeri HP) ditulis "—". */
export const formatSize = (n: number) => (n < 0 ? '—' : formatBytes(n));
