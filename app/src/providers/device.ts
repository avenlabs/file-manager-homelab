import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import {
  Album,
  Asset,
  AssetField,
  MediaType,
  Query,
  requestPermissionsAsync,
} from 'expo-media-library';
import { UploadError } from '../api';
import { mimeFromName } from '../fileTypes';
import type { FileItem, FolderCaps, StorageProvider, UploadAdapter } from './types';

// ID item di HP ini:
//   device:          root (daftar lokasi)
//   gallery:         daftar album
//   album:* | album:<id>   isi album (foto & video)
//   asset:<id>       satu foto/video di galeri
//   dir:<uri> | file:<uri> folder/file di penyimpanan
const ROOT = 'device:';
const GALLERY = 'gallery:';
const ALL_MEDIA = 'album:*';
const PICK = 'pick-folder';
const MEDIA_LIMIT = 2000;

const iso = (ms: number | null | undefined) => new Date(ms ?? Date.now()).toISOString();
const uriOf = (id: string) => id.slice(id.indexOf(':') + 1);

function appFolder(): Directory {
  const dir = new Directory(Paths.document, 'Casa Files');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

function uniqueFile(dir: Directory, name: string): File {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let f = new File(dir, name);
  for (let i = 1; f.exists; i++) f = new File(dir, `${base} (${i})${ext}`);
  return f;
}

async function ensureMediaPermission() {
  const res = await requestPermissionsAsync(false, ['photo', 'video']);
  if (!res.granted) throw new Error('Izin Galeri ditolak. Aktifkan izin Foto & Video untuk Casa Files di Pengaturan HP.');
}

/**
 * Penyimpanan di HP: galeri foto/video, folder "Casa Files" milik app, dan folder lain yang
 * dipilih user (Android: akses folder via Storage Access Framework; iOS: folder dari app Files).
 * Catatan: iOS & Android modern tidak mengizinkan app membaca SELURUH penyimpanan HP.
 */
export class DeviceProvider implements StorageProvider {
  readonly kind = 'device' as const;
  readonly root = { id: ROOT, name: 'HP ini' };
  readonly features = { hidden: true };
  readonly subtitle = 'Galeri & folder di HP';
  readonly uploader: UploadAdapter;

  constructor(
    readonly id: string,
    readonly label: string,
    private folders: { uri: string; name: string }[],
    private onFoldersChange: (folders: { uri: string; name: string }[]) => void,
  ) {
    this.uploader = {
      init: async () => {
        throw new UploadError('Tujuan lokal memakai salin langsung', true);
      },
      chunk: async () => {
        throw new UploadError('Tujuan lokal memakai salin langsung', true);
      },
      complete: async () => 'done',
      direct: (localUri, dir, name, size) => this.saveHere(localUri, dir, name, size),
    };
  }

  caps(folderId: string): FolderCaps {
    if (folderId.startsWith('dir:')) return { write: true, upload: true, flags: false, copyMove: true, remove: true };
    if (folderId.startsWith('album:')) return { write: false, upload: true, flags: false, copyMove: false, remove: true };
    return { write: false, upload: false, flags: false, copyMove: false, remove: false };
  }

  async list(folderId: string, opts?: { hidden?: boolean }): Promise<FileItem[]> {
    if (Platform.OS === 'web') throw new Error('Penyimpanan HP hanya tersedia di app iPhone / Android.');
    if (folderId === ROOT) return this.listRoot();
    if (folderId === GALLERY) return this.listAlbums();
    if (folderId.startsWith('album:')) return this.listAlbum(folderId);
    if (folderId.startsWith('dir:')) return this.listDir(folderId, !!opts?.hidden);
    throw new Error('Lokasi tidak dikenal');
  }

  private listRoot(): FileItem[] {
    const now = iso(null);
    const folder = (path: string, name: string): FileItem => ({ name, path, isDir: true, size: -1, modTime: now });
    return [
      folder(GALLERY, 'Galeri'),
      folder(`dir:${appFolder().uri}`, 'Casa Files (di HP)'),
      ...this.folders.map((f) => folder(`dir:${f.uri}`, f.name)),
      { ...folder('', 'Tambah folder dari HP…'), path: `action:${PICK}`, action: PICK, isDir: false },
    ];
  }

  private async listAlbums(): Promise<FileItem[]> {
    await ensureMediaPermission();
    const albums = await Album.getAll();
    const rows: FileItem[] = await Promise.all(
      albums.map(async (a) => ({
        name: await a.getTitle(),
        path: `album:${a.id}`,
        isDir: true,
        size: -1,
        modTime: iso(null),
        count: await a.getAssetCount().catch(() => 0),
      })),
    );
    return [
      { name: 'Semua foto & video', path: ALL_MEDIA, isDir: true, size: -1, modTime: iso(null) },
      ...rows.filter((r) => (r.count ?? 0) > 0).sort((a, b) => (b.count ?? 0) - (a.count ?? 0)),
    ];
  }

  private async listAlbum(folderId: string): Promise<FileItem[]> {
    await ensureMediaPermission();
    let q = new Query()
      .within(AssetField.MEDIA_TYPE, [MediaType.IMAGE, MediaType.VIDEO])
      .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
      .limit(MEDIA_LIMIT);
    if (folderId !== ALL_MEDIA) q = q.album(new Album(uriOf(folderId)));
    const assets = await q.exeForMetadata();
    return assets.map((a) => {
      const name = a.filename ?? `${a.id}.${a.mediaType === MediaType.VIDEO ? 'mp4' : 'jpg'}`;
      const fallback = a.mediaType === MediaType.VIDEO ? 'video/mp4' : 'image/jpeg';
      const item: FileItem = { name, path: `asset:${a.id}`, isDir: false, size: -1, modTime: iso(a.creationTime) };
      item.mime = mimeFromName(name) ?? fallback;
      return item;
    });
  }

  private listDir(folderId: string, hidden: boolean): FileItem[] {
    const dir = new Directory(uriOf(folderId));
    if (!dir.exists) throw new Error('Folder tidak bisa diakses lagi. Pilih ulang foldernya dari "Tambah folder dari HP…".');
    return dir
      .list()
      .filter((e) => hidden || !e.name.startsWith('.'))
      .map((e) => {
        const isDir = e instanceof Directory;
        const item: FileItem = {
          name: e.name,
          path: `${isDir ? 'dir' : 'file'}:${e.uri}`,
          isDir,
          size: isDir ? -1 : (e as File).size,
          modTime: iso(isDir ? null : (e as File).modificationTime),
          parentId: folderId,
        };
        if (!isDir) item.mime = mimeFromName(e.name);
        return item;
      })
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
  }

  async runAction(action: string) {
    if (action !== PICK) return;
    const dir = await Directory.pickDirectoryAsync();
    if (this.folders.some((f) => f.uri === dir.uri)) return;
    this.folders = [...this.folders, { uri: dir.uri, name: dir.name || 'Folder' }];
    this.onFoldersChange(this.folders);
  }

  /** URI lokal yang bisa dibaca app lain/mesin upload. */
  private async localUri(item: FileItem): Promise<string> {
    if (item.path.startsWith('asset:')) return new Asset(uriOf(item.path)).getUri();
    return uriOf(item.path);
  }

  async thumbnail(item: FileItem) {
    if (item.path.startsWith('asset:') || (item.mime ?? '').startsWith('image/')) return { uri: await this.localUri(item) };
    return null;
  }

  async source(item: FileItem) {
    return { uri: await this.localUri(item) };
  }

  async download(item: FileItem) {
    return new File(await this.localUri(item));
  }

  async mkdir(parentId: string, name: string) {
    new Directory(uriOf(parentId)).createDirectory(name);
  }

  async rename(item: FileItem, name: string) {
    const uri = uriOf(item.path);
    (item.isDir ? new Directory(uri) : new File(uri)).rename(name);
  }

  async remove(items: FileItem[]) {
    const assets = items.filter((i) => i.path.startsWith('asset:'));
    if (assets.length) await Asset.delete(assets.map((a) => new Asset(uriOf(a.path))));
    for (const i of items) {
      if (i.path.startsWith('asset:')) continue;
      const uri = uriOf(i.path);
      (i.isDir ? new Directory(uri) : new File(uri)).delete();
    }
  }

  async copy(items: FileItem[], destId: string) {
    const dest = new Directory(uriOf(destId));
    for (const i of items) {
      if (i.isDir) await new Directory(uriOf(i.path)).copy(dest);
      else await new File(await this.localUri(i)).copy(uniqueFile(dest, i.name));
    }
  }

  async move(items: FileItem[], destId: string) {
    const dest = new Directory(uriOf(destId));
    for (const i of items) {
      if (i.isDir) await new Directory(uriOf(i.path)).move(dest);
      else await new File(uriOf(i.path)).move(uniqueFile(dest, i.name));
    }
  }

  /** Simpan file lokal ke folder HP (atau ke Galeri jika tujuannya album). */
  private async saveHere(localUri: string, dirId: string, name: string, size: number): Promise<'done' | 'skipped'> {
    const src = new File(localUri);
    if (dirId.startsWith('album:')) {
      await ensureMediaPermission();
      await Asset.create(localUri, dirId === ALL_MEDIA ? undefined : new Album(uriOf(dirId)));
      return 'done';
    }
    const dir = new Directory(uriOf(dirId));
    const same = new File(dir, name);
    if (same.exists && same.size === size) return 'skipped';
    await src.copy(uniqueFile(dir, name));
    return 'done';
  }

  async storage() {
    if (Platform.OS === 'web') return null;
    const total = Paths.totalDiskSpace;
    const free = Paths.availableDiskSpace;
    return total ? { total, free, used: total - free } : null;
  }
}
