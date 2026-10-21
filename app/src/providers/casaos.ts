import { Directory, File, Paths } from 'expo-file-system';
import {
  abortUpload,
  completeUpload,
  copyItems,
  createChunkTask,
  deleteItems,
  fileUrl,
  initUpload,
  joinPath,
  listDir,
  mkdir,
  moveItems,
  parentPath,
  rename,
  setFlag,
  storageInfo,
  uploadErrorFrom,
  type Session,
} from '../api';
import type { FileItem, StorageProvider, UploadAdapter } from './types';

export async function downloadTo(url: string, name: string, headers?: Record<string, string>): Promise<File> {
  const dir = new Directory(Paths.cache, 'shared');
  dir.create({ idempotent: true, intermediates: true });
  const dest = new File(dir, name);
  if (dest.exists) dest.delete();
  return File.downloadFileAsync(url, dest, headers ? { headers } : undefined);
}

/** Server CasaOS (casa-files-server). ID item = path di server. */
export class CasaOSProvider implements StorageProvider {
  readonly kind = 'casaos' as const;
  readonly root = { id: '/', name: 'Storage' };
  readonly features = { analytics: true, hidden: true };
  readonly subtitle: string;
  readonly uploader: UploadAdapter;

  constructor(
    readonly id: string,
    readonly label: string,
    readonly session: Session,
  ) {
    this.subtitle = session.baseUrl.replace(/^https?:\/\//, '');
    const s = session;
    this.uploader = {
      async init(dir, name, size, modTime) {
        const r = await initUpload(s, dir, name, size, modTime);
        return r.status === 'exists' ? { status: 'exists' } : { status: 'upload', session: r.id, offset: r.offset };
      },
      async chunk(sessionId, offset, _len, _size, chunkFile, onProgress) {
        const task = createChunkTask(s, sessionId, offset, chunkFile, onProgress);
        return {
          task,
          parse: (res) => {
            let body: any = null;
            try {
              body = JSON.parse(res.body);
            } catch {}
            if (res.status === 200 || res.status === 409) return Number(body?.offset ?? offset);
            throw uploadErrorFrom(res.status, body);
          },
        };
      },
      complete: (sessionId) => completeUpload(s, sessionId),
      abort: (sessionId) => abortUpload(s, sessionId),
    };
  }

  caps() {
    return { write: true, upload: true, flags: true, copyMove: true, remove: true };
  }

  async list(folderId: string, opts?: { hidden?: boolean }): Promise<FileItem[]> {
    const res = await listDir(this.session, folderId, opts?.hidden);
    return res.entries.map((e) => ({ ...e, parentId: folderId }));
  }

  thumbnail(item: FileItem) {
    return { uri: fileUrl(this.session, item.path) };
  }

  async source(item: FileItem) {
    return { uri: fileUrl(this.session, item.path) };
  }

  download(item: FileItem) {
    return downloadTo(fileUrl(this.session, item.path), item.name);
  }

  async mkdir(parentId: string, name: string) {
    await mkdir(this.session, joinPath(parentId, name));
  }

  async rename(item: FileItem, name: string) {
    await rename(this.session, item.path, joinPath(parentPath(item.path), name));
  }

  async remove(items: FileItem[]) {
    await deleteItems(
      this.session,
      items.map((i) => i.path),
    );
  }

  async copy(items: FileItem[], destId: string) {
    await copyItems(
      this.session,
      items.map((i) => i.path),
      destId,
    );
  }

  async move(items: FileItem[], destId: string) {
    await moveItems(
      this.session,
      items.map((i) => i.path),
      destId,
    );
  }

  async setFlag(items: FileItem[], color: Parameters<typeof setFlag>[2]) {
    await setFlag(
      this.session,
      items.map((i) => i.path),
      color,
    );
  }

  storage() {
    return storageInfo(this.session);
  }
}
