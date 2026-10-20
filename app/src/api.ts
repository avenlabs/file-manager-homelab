import { File, UploadTask, UploadType } from 'expo-file-system';

export type Entry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modTime: string;
  mime?: string;
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

export async function login(baseUrl: string, password: string): Promise<Session> {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
  return { baseUrl, token: data.token };
}

export const listDir = (s: Session, path: string) =>
  request<{ path: string; entries: Entry[] }>(s, 'GET', `/list?path=${encodeURIComponent(path)}`);

export const storageInfo = (s: Session) => request<StorageInfo>(s, 'GET', '/storage');

export const mkdir = (s: Session, path: string) => request(s, 'POST', '/mkdir', { path });

export const rename = (s: Session, from: string, to: string) =>
  request(s, 'POST', '/rename', { from, to });

export const remove = (s: Session, path: string) =>
  request(s, 'DELETE', `/delete?path=${encodeURIComponent(path)}`);

/** URL file dengan token di query, untuk <Image>, <VideoView> dan download. */
export function fileUrl(s: Session, path: string, download = false): string {
  const q = `path=${encodeURIComponent(path)}&token=${encodeURIComponent(s.token)}`;
  return `${s.baseUrl}/api/file?${q}${download ? '&download=1' : ''}`;
}

/** Membuat upload task (belum dimulai). sessionType background agar tetap jalan saat app di-minimize. */
export function createUpload(
  s: Session,
  localUri: string,
  destDir: string,
  name: string,
  mimeType: string | undefined,
  onProgress: (sent: number, total: number) => void,
): UploadTask {
  const url = `${s.baseUrl}/api/upload?path=${encodeURIComponent(destDir)}&name=${encodeURIComponent(name)}`;
  return new File(localUri).createUploadTask(url, {
    httpMethod: 'POST',
    uploadType: UploadType.MULTIPART,
    fieldName: 'file',
    mimeType,
    headers: { Authorization: `Bearer ${s.token}` },
    sessionType: 'background',
    onProgress: ({ bytesSent, totalBytes }) => onProgress(bytesSent, totalBytes),
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

export const isImage = (e: Entry) => !!e.mime?.startsWith('image/') || /\.(heic|heif|webp)$/i.test(e.name);
export const isVideo = (e: Entry) => !!e.mime?.startsWith('video/') || /\.(mov|mkv|m4v)$/i.test(e.name);

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}
