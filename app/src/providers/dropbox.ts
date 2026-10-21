import { UploadType } from 'expo-file-system';
import { UploadError } from '../api';
import { downloadTo } from './casaos';
import { TokenManager } from './oauth';
import type { FileItem, StorageProvider, UploadAdapter } from './types';

const RPC = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';

/** Header Dropbox-API-Arg wajib ASCII: karakter non-ASCII di-escape sebagai \uXXXX. */
export const dropboxArg = (o: unknown) =>
  JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

const join = (dir: string, name: string) => `${dir}/${name}`;
const parentOf = (p: string) => p.slice(0, p.lastIndexOf('/'));

/** Pesan error yang bisa dibaca dari error_summary Dropbox (mis. "path/not_found/.."). */
export function dropboxMessage(status: number, body: any): string {
  const summary: string = body?.error_summary ?? '';
  if (summary.includes('insufficient_space')) return 'Ruang Dropbox penuh';
  if (summary.includes('not_found')) return 'File/folder tidak ditemukan di Dropbox';
  if (summary.includes('conflict')) return 'Sudah ada file/folder dengan nama itu';
  if (summary.includes('too_many')) return 'Terlalu banyak permintaan ke Dropbox, coba sebentar lagi';
  if (status === 401) return 'Akses Dropbox kedaluwarsa';
  return summary ? `Dropbox: ${summary}` : `Dropbox error ${status}`;
}

type UploadSession = { id: string; key: string; path: string; offset: number };

/** Dropbox. ID item = path_lower (path root = ""). */
export class DropboxProvider implements StorageProvider {
  readonly kind = 'dropbox' as const;
  readonly root = { id: '', name: 'Dropbox' };
  readonly features = {};
  readonly uploader: UploadAdapter;
  private tokens: TokenManager;
  private links = new Map<string, { url: string; expires: number }>();
  private byKey = new Map<string, UploadSession>();
  private byId = new Map<string, UploadSession>();

  constructor(
    readonly id: string,
    readonly label: string,
    readonly subtitle: string,
  ) {
    this.tokens = new TokenManager(id, 'dropbox');
    this.uploader = this.makeUploader();
  }

  private async auth() {
    return { Authorization: `Bearer ${await this.tokens.accessToken()}` };
  }

  private async fetchAuthed(url: string, init: RequestInit): Promise<Response> {
    const go = async () =>
      fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), ...(await this.auth()) } });
    let res = await go();
    if (res.status === 401) {
      await this.tokens.refresh();
      res = await go();
    }
    return res;
  }

  /** Panggil endpoint RPC Dropbox (JSON in/out). */
  private async rpc<T>(endpoint: string, body: unknown = null): Promise<T> {
    const res = await this.fetchAuthed(`${RPC}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(dropboxMessage(res.status, data)), { status: res.status, body: data });
    return data as T;
  }

  caps() {
    return { write: true, upload: true, flags: false, copyMove: true, remove: true };
  }

  async list(folderId: string): Promise<FileItem[]> {
    const items: FileItem[] = [];
    let res = await this.rpc<{ entries: any[]; cursor: string; has_more: boolean }>('files/list_folder', {
      path: folderId,
      limit: 2000,
    });
    for (;;) {
      for (const e of res.entries) {
        if (e['.tag'] === 'deleted') continue;
        items.push({
          name: e.name,
          path: e.path_lower,
          isDir: e['.tag'] === 'folder',
          size: e.size ?? 0,
          modTime: e.server_modified ?? e.client_modified ?? new Date(0).toISOString(),
          parentId: folderId,
        });
      }
      if (!res.has_more || items.length >= 10000) break;
      res = await this.rpc('files/list_folder/continue', { cursor: res.cursor });
    }
    return items.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
  }

  thumbnail() {
    return null;
  }

  /** Link sementara Dropbox (berlaku 4 jam) untuk preview/streaming tanpa header. */
  private async tempLink(item: FileItem): Promise<string> {
    const cached = this.links.get(item.path);
    if (cached && cached.expires > Date.now()) return cached.url;
    const { link } = await this.rpc<{ link: string }>('files/get_temporary_link', { path: item.path });
    this.links.set(item.path, { url: link, expires: Date.now() + 3.5 * 3600 * 1000 });
    return link;
  }

  async source(item: FileItem) {
    return { uri: await this.tempLink(item) };
  }

  async download(item: FileItem) {
    return downloadTo(await this.tempLink(item), item.name);
  }

  async mkdir(parentId: string, name: string) {
    await this.rpc('files/create_folder_v2', { path: join(parentId, name), autorename: false });
  }

  async rename(item: FileItem, name: string) {
    await this.rpc('files/move_v2', { from_path: item.path, to_path: join(parentOf(item.path), name) });
  }

  async remove(items: FileItem[]) {
    for (const i of items) await this.rpc('files/delete_v2', { path: i.path });
  }

  async copy(items: FileItem[], destId: string) {
    for (const i of items) await this.rpc('files/copy_v2', { from_path: i.path, to_path: join(destId, i.name), autorename: true });
  }

  async move(items: FileItem[], destId: string) {
    for (const i of items) {
      if (parentOf(i.path) === destId) continue;
      await this.rpc('files/move_v2', { from_path: i.path, to_path: join(destId, i.name), autorename: true });
    }
  }

  async storage() {
    const r = await this.rpc<{ used: number; allocation: { allocated?: number } }>('users/get_space_usage');
    const total = r.allocation?.allocated ?? 0;
    return total ? { total, used: r.used, free: Math.max(0, total - r.used) } : null;
  }

  private forget(s: UploadSession) {
    this.byKey.delete(s.key);
    this.byId.delete(s.id);
  }

  private makeUploader(): UploadAdapter {
    const self = this;
    return {
      async init(dir, name, size) {
        const path = join(dir, name);
        const key = `${path}\u0000${size}`;
        // Idempotent: file dengan nama & ukuran sama sudah ada → lewati.
        try {
          const meta = await self.rpc<any>('files/get_metadata', { path });
          if (meta['.tag'] === 'file' && meta.size === size) return { status: 'exists' };
        } catch (e: any) {
          if (e?.status !== 409) throw new UploadError(e?.message ?? 'Gagal memeriksa Dropbox');
        }
        const existing = self.byKey.get(key);
        if (existing) return { status: 'upload', session: existing.id, offset: existing.offset };

        const res = await self.fetchAuthed(`${CONTENT}/files/upload_session/start`, {
          method: 'POST',
          headers: { 'Dropbox-API-Arg': dropboxArg({ close: false }), 'Content-Type': 'application/octet-stream' },
          body: '',
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.session_id) throw new UploadError(dropboxMessage(res.status, data));
        const s: UploadSession = { id: data.session_id, key, path, offset: 0 };
        self.byKey.set(key, s);
        self.byId.set(s.id, s);
        return { status: 'upload', session: s.id, offset: 0 };
      },

      async chunk(sessionId, offset, len, _size, chunkFile, onProgress) {
        const task = chunkFile.createUploadTask(`${CONTENT}/files/upload_session/append_v2`, {
          httpMethod: 'POST',
          uploadType: UploadType.BINARY_CONTENT,
          headers: {
            ...(await self.auth()),
            'Dropbox-API-Arg': dropboxArg({ cursor: { session_id: sessionId, offset }, close: false }),
            'Content-Type': 'application/octet-stream',
          },
          sessionType: 'background',
          onProgress: ({ bytesSent }) => onProgress(bytesSent),
        });
        return {
          task,
          parse: (res) => {
            const s = self.byId.get(sessionId);
            let body: any = null;
            try {
              body = JSON.parse(res.body);
            } catch {}
            let next: number | null = null;
            if (res.status === 200) next = offset + len;
            else if (res.status === 409 && body?.error?.correct_offset != null) next = Number(body.error.correct_offset);
            else if (res.status === 409 && /incorrect_offset/.test(body?.error_summary ?? '')) {
              next = Number(body?.error?.correct_offset ?? offset);
            }
            if (next !== null) {
              if (s) s.offset = next;
              return next;
            }
            if (/not_found|closed/.test(body?.error_summary ?? '') && s) self.forget(s); // sesi kedaluwarsa → mulai ulang
            const msg = dropboxMessage(res.status, body);
            throw new UploadError(msg, msg === 'Ruang Dropbox penuh');
          },
        };
      },

      async complete(sessionId, size) {
        const s = self.byId.get(sessionId);
        if (!s) return 'retry';
        const res = await self.fetchAuthed(`${CONTENT}/files/upload_session/finish`, {
          method: 'POST',
          headers: {
            'Dropbox-API-Arg': dropboxArg({
              cursor: { session_id: sessionId, offset: size },
              commit: { path: s.path, mode: 'add', autorename: true, mute: false },
            }),
            'Content-Type': 'application/octet-stream',
          },
          body: '',
        });
        if (res.ok) {
          self.forget(s);
          return 'done';
        }
        const body = await res.json().catch(() => null);
        if (res.status === 409 && /incorrect_offset/.test(body?.error_summary ?? '')) {
          s.offset = Number(body?.error?.lookup_failed?.correct_offset ?? body?.error?.correct_offset ?? s.offset);
          return 'retry';
        }
        if (/not_found|closed/.test(body?.error_summary ?? '')) {
          self.forget(s);
          return 'retry';
        }
        const msg = dropboxMessage(res.status, body);
        throw new UploadError(msg, msg === 'Ruang Dropbox penuh');
      },

      async abort(sessionId) {
        const s = self.byId.get(sessionId);
        if (s) self.forget(s);
      },
    };
  }
}
