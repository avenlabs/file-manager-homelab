import type { File, UploadResult, UploadTask } from 'expo-file-system';
import type { Entry, StorageInfo } from '../api';
import type { FlagColor } from '../theme';

export type ProviderKind = 'device' | 'casaos' | 'gdrive' | 'dropbox';

/**
 * Item file/folder dari sumber mana pun.
 * `path` adalah ID unik di dalam sumbernya (path CasaOS, ID file Drive, path Dropbox, URI lokal)
 * sehingga bisa dipakai langsung sebagai key, untuk seleksi, dan untuk operasi.
 */
export type FileItem = Entry & {
  /** Folder induk (ID), jika diketahui. Dipakai untuk pindah di Drive. */
  parentId?: string;
  /** Thumbnail siap pakai (tanpa header), jika sumber menyediakannya. */
  thumb?: string;
  /** Link untuk membuka di aplikasi/web sumbernya (mis. Google Docs). */
  webUrl?: string;
  /** File native sumber yang tidak bisa diunduh mentah (Google Docs/Sheets/Slides). */
  cloudDoc?: boolean;
  /** Jumlah isi folder, jika sumber menyediakannya (mis. album galeri). */
  count?: number;
  /** Item aksi khusus (mis. "Pilih folder lain…" di HP ini), bukan file sungguhan. */
  action?: string;
};

export type Folder = { id: string; name: string };

/** Sumber data media: URL + header otorisasi (untuk gambar, video, teks). */
export type MediaSource = { uri: string; headers?: Record<string, string> };

/** Apa saja yang bisa dilakukan di sebuah folder. */
export type FolderCaps = {
  write: boolean; // buat folder, ganti nama, hapus, tempel
  upload: boolean; // upload dari picker / tempel dari sumber lain
  flags: boolean;
  copyMove: boolean; // salin/pindah di dalam sumber yang sama
  remove: boolean;
};

export type UploadInitResult = { status: 'exists' } | { status: 'upload'; session: string; offset: number };

/**
 * Protokol upload per potongan yang dipakai mesin upload (useUploads):
 * init → kirim potongan (task native) → complete. Semua retry/watchdog ada di mesin upload.
 */
export interface UploadAdapter {
  init(dir: string, name: string, size: number, modTime?: number): Promise<UploadInitResult>;
  /** Buat task untuk satu potongan; `parse` mengubah respons menjadi offset baru (atau melempar UploadError). */
  chunk(
    session: string,
    offset: number,
    len: number,
    size: number,
    chunkFile: File,
    onProgress: (sent: number) => void,
  ): Promise<{ task: UploadTask; parse: (res: UploadResult) => number }>;
  complete(session: string, size: number): Promise<'done' | 'retry'>;
  abort?(session: string): Promise<void>;
  /**
   * Alternatif untuk tujuan lokal (HP ini): salin langsung tanpa potongan/jaringan.
   * Jika ada, mesin upload memakai ini dan mengabaikan init/chunk/complete.
   */
  direct?(localUri: string, dir: string, name: string, size: number): Promise<'done' | 'skipped'>;
}

export interface StorageProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly label: string;
  readonly subtitle: string;
  readonly root: Folder;
  /** Fitur di luar operasi file standar. */
  readonly features: { analytics?: boolean; hidden?: boolean };

  caps(folderId: string): FolderCaps;
  list(folderId: string, opts?: { hidden?: boolean }): Promise<FileItem[]>;

  /** Thumbnail kecil untuk daftar/grid (boleh async, mis. galeri HP). */
  thumbnail(item: FileItem): MediaSource | Promise<MediaSource | null> | null;
  /** Sumber untuk preview (gambar, video, audio, teks, PDF). */
  source(item: FileItem): Promise<MediaSource>;
  /** Unduh ke cache lokal (untuk bagikan / buka di app lain / salin ke sumber lain). */
  download(item: FileItem): Promise<File>;

  mkdir(parentId: string, name: string): Promise<void>;
  rename(item: FileItem, name: string): Promise<void>;
  remove(items: FileItem[]): Promise<void>;
  copy(items: FileItem[], destId: string): Promise<void>;
  move(items: FileItem[], destId: string): Promise<void>;
  setFlag?(items: FileItem[], color: FlagColor | null): Promise<void>;
  /** Jalankan item aksi khusus (FileItem.action). */
  runAction?(action: string): Promise<void>;

  storage?(): Promise<StorageInfo | null>;
  readonly uploader?: UploadAdapter;
}

/** Konfigurasi sumber yang disimpan (rahasia/token disimpan terpisah di SecureStore). */
export type SourceConfig =
  | { id: string; kind: 'device'; label: string; folders: { uri: string; name: string }[] }
  | { id: string; kind: 'casaos'; label: string; baseUrl: string }
  | { id: string; kind: 'gdrive'; label: string; email?: string }
  | { id: string; kind: 'dropbox'; label: string; email?: string };
