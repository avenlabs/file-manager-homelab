import { UploadType } from 'expo-file-system';
import { UploadError } from '../api';
import { downloadTo } from './casaos';
import { TokenManager } from './oauth';
import type { FileItem, StorageProvider, UploadAdapter } from './types';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink,parents';

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const header = (headers: Record<string, string>, name: string) =>
  Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1];

/** "bytes=0-1048575" → 1048576 (byte berikutnya yang diharapkan). */
export function nextOffsetFromRange(range: string | undefined): number {
  const m = range?.match(/bytes=0-(\d+)/);
  return m ? Number(m[1]) + 1 : 0;
}

async function driveError(res: Response): Promise<Error> {
  const body = await res.json().catch(() => null);
  const reason = body?.error?.errors?.[0]?.reason as string | undefined;
  const msg = body?.error?.message as string | undefined;
  if (reason === 'storageQuotaExceeded') return new UploadError('Kuota Google Drive penuh', true);
  if (res.status === 404) return new Error('File/folder tidak ditemukan di Google Drive');
  if (res.status === 403) return new Error(msg ? `Ditolak Google Drive: ${msg}` : 'Ditolak Google Drive');
  return new Error(msg ? `Google Drive: ${msg}` : `Google Drive error ${res.status}`);
}

/** Google Drive (My Drive). ID item = ID file Drive. */
export class GDriveProvider implements StorageProvider {
  readonly kind = 'gdrive' as const;
  readonly root = { id: 'root', name: 'My Drive' };
  readonly features = {};
  readonly uploader: UploadAdapter;
  private tokens: TokenManager;
  /** Sesi upload resumable yang masih aktif, agar retry melanjutkan, bukan mulai dari nol. */
  private sessions = new Map<string, string>();

  constructor(
    readonly id: string,
    readonly label: string,
    readonly subtitle: string,
  ) {
    this.tokens = new TokenManager(id, 'google');
    this.uploader = this.makeUploader();
  }

  private async auth(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.tokens.accessToken()}` };
  }

  /** fetch ke Drive dengan token; jika 401, refresh token sekali lalu ulangi. */
  private async req(url: string, init: RequestInit = {}): Promise<Response> {
    const go = async () =>
      fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), ...(await this.auth()) } });
    let res = await go();
    if (res.status === 401) {
      await this.tokens.refresh();
      res = await go();
    }
    return res;
  }

  private async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.req(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
    });
    if (!res.ok) throw await driveError(res);
    return res.status === 204 ? (undefined as T) : res.json();
  }

  caps() {
    return { write: true, upload: true, flags: false, copyMove: true, remove: true };
  }

  async list(folderId: string): Promise<FileItem[]> {
    const items: FileItem[] = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        q: `${quote(folderId)} in parents and trashed=false`,
        fields: `nextPageToken,files(${FIELDS})`,
        pageSize: '1000',
        orderBy: 'folder,name',
        ...(pageToken ? { pageToken } : {}),
      });
      const res = await this.json<{ files: any[]; nextPageToken?: string }>(`${API}/files?${params}`);
      for (const f of res.files) items.push(this.toItem(f, folderId));
      pageToken = res.nextPageToken ?? '';
    } while (pageToken && items.length < 10000);
    return items;
  }

  private toItem(f: any, parentId: string): FileItem {
    const isDir = f.mimeType === FOLDER;
    return {
      name: f.name,
      path: f.id,
      isDir,
      size: Number(f.size ?? 0),
      modTime: f.modifiedTime,
      mime: isDir ? undefined : f.mimeType,
      parentId: f.parents?.[0] ?? parentId,
      thumb: f.thumbnailLink,
      webUrl: f.webViewLink,
      cloudDoc: !isDir && String(f.mimeType).startsWith('application/vnd.google-apps.'),
    };
  }

  async thumbnail(item: FileItem) {
    if (!item.thumb) return null;
    return { uri: item.thumb, headers: await this.auth() };
  }

  async source(item: FileItem) {
    return { uri: `${API}/files/${item.path}?alt=media`, headers: await this.auth() };
  }

  async download(item: FileItem) {
    if (item.cloudDoc) throw new Error('Dokumen Google tidak bisa diunduh langsung; buka di Google Drive.');
    return downloadTo(`${API}/files/${item.path}?alt=media`, item.name, await this.auth());
  }

  async mkdir(parentId: string, name: string) {
    await this.json(`${API}/files`, {
      method: 'POST',
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
    });
  }

  async rename(item: FileItem, name: string) {
    await this.json(`${API}/files/${item.path}`, { method: 'PATCH', body: JSON.stringify({ name }) });
  }

  /** Dipindah ke Sampah Drive (masih bisa dipulihkan dari Google Drive). */
  async remove(items: FileItem[]) {
    for (const i of items) {
      await this.json(`${API}/files/${i.path}`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) });
    }
  }

  async copy(items: FileItem[], destId: string) {
    for (const i of items) {
      if (i.isDir) throw new Error(`Folder "${i.name}" belum bisa disalin di Google Drive`);
      await this.json(`${API}/files/${i.path}/copy`, {
        method: 'POST',
        body: JSON.stringify({ name: i.name, parents: [destId] }),
      });
    }
  }

  async move(items: FileItem[], destId: string) {
    for (const i of items) {
      const params = new URLSearchParams({ addParents: destId, ...(i.parentId ? { removeParents: i.parentId } : {}) });
      await this.json(`${API}/files/${i.path}?${params}`, { method: 'PATCH', body: '{}' });
    }
  }

  async storage() {
    const res = await this.json<{ storageQuota: { limit?: string; usage: string } }>(
      `${API}/about?fields=storageQuota`,
    );
    const used = Number(res.storageQuota.usage);
    const total = Number(res.storageQuota.limit ?? 0);
    return total ? { total, used, free: Math.max(0, total - used) } : null;
  }

  private makeUploader(): UploadAdapter {
    const self = this;
    return {
      async init(dir, name, size) {
        const key = `${dir}\u0000${name}\u0000${size}`;
        // Idempotent: file dengan nama & ukuran sama sudah ada → lewati.
        const q = `name=${quote(name)} and ${quote(dir)} in parents and trashed=false`;
        const found = await self.json<{ files: { id: string; size?: string }[] }>(
          `${API}/files?${new URLSearchParams({ q, fields: 'files(id,size)' })}`,
        );
        if (found.files.some((f) => Number(f.size ?? -1) === size)) {
          self.sessions.delete(key);
          return { status: 'exists' };
        }
        // Lanjutkan sesi yang sudah ada: tanyakan Drive sudah sampai byte ke berapa.
        const existing = self.sessions.get(key);
        if (existing) {
          const res = await self.req(existing, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}` } });
          if (res.status === 308) return { status: 'upload', session: existing, offset: nextOffsetFromRange(res.headers.get('range') ?? undefined) };
          if (res.status === 200 || res.status === 201) return { status: 'exists' };
          self.sessions.delete(key); // sesi kedaluwarsa → buat baru
        }
        const res = await self.req(`${UPLOAD}?uploadType=resumable`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size) },
          body: JSON.stringify({ name, parents: [dir] }),
        });
        if (!res.ok) throw await driveError(res);
        const url = res.headers.get('location');
        if (!url) throw new UploadError('Google Drive tidak memberikan sesi upload');
        self.sessions.set(key, url);
        return { status: 'upload', session: url, offset: 0 };
      },

      async chunk(url, offset, len, size, chunkFile, onProgress) {
        const task = chunkFile.createUploadTask(url, {
          httpMethod: 'PUT',
          uploadType: UploadType.BINARY_CONTENT,
          headers: { ...(await self.auth()), 'Content-Range': `bytes ${offset}-${offset + len - 1}/${size}` },
          sessionType: 'background',
          onProgress: ({ bytesSent }) => onProgress(bytesSent),
        });
        return {
          task,
          parse: (res) => {
            if (res.status === 308) return nextOffsetFromRange(header(res.headers, 'range'));
            if (res.status === 200 || res.status === 201) return size;
            if (res.status === 401) throw new UploadError('Token Google kedaluwarsa, diperbarui');
            if (res.status === 404 || res.status === 410) {
              for (const [k, v] of self.sessions) if (v === url) self.sessions.delete(k);
              throw new UploadError('Sesi upload Google Drive kedaluwarsa, dimulai ulang');
            }
            if (/storageQuotaExceeded/.test(res.body)) throw new UploadError('Kuota Google Drive penuh', true);
            throw new UploadError(`Google Drive error ${res.status}`);
          },
        };
      },

      async complete(url, size) {
        if (size === 0) {
          const res = await self.req(url, { method: 'PUT', headers: { 'Content-Range': 'bytes */0' } });
          if (!res.ok) throw await driveError(res);
        }
        for (const [k, v] of self.sessions) if (v === url) self.sessions.delete(k);
        return 'done';
      },

      async abort(url) {
        for (const [k, v] of self.sessions) if (v === url) self.sessions.delete(k);
        await self.req(url, { method: 'DELETE' }).catch(() => {});
      },
    };
  }
}
