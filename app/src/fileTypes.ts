import {
  Archive,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileType,
  Film,
  Folder,
  Image as ImageIcon,
  Music,
  Presentation,
  File as FileIcon,
} from 'lucide-react-native';
import type { Entry } from './api';
import type { Icon } from './components/ui';

export type Category = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other';

/** Cara file dibuka di app. */
export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'office' | 'other';

const groups: Record<Exclude<Category, 'other'>, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'svg', 'avif', 'raw', 'dng', 'cr2', 'cr3', 'nef', 'arw'],
  video: ['mp4', 'mov', 'mkv', 'avi', 'm4v', 'webm', '3gp', 'wmv', 'flv', 'ts', 'mts'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'wma', 'aiff'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'txt', 'md', 'csv', 'rtf', 'pages', 'numbers', 'key', 'epub'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'iso', 'dmg'],
};

const extToCategory: Record<string, Category> = Object.fromEntries(
  Object.entries(groups).flatMap(([cat, exts]) => exts.map((e) => [e, cat as Category])),
);

// Dokumen Office tidak di-preview di app; diserahkan ke Google Drive / Docs / Sheets / Slides.
const officeMime: Record<string, string> = {
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
};

const textExt = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'yaml', 'yml', 'toml', 'ini', 'env', 'conf', 'cfg',
  'xml', 'html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'go', 'py', 'rs', 'java', 'kt', 'swift',
  'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'rb', 'sh', 'bash', 'zsh', 'sql', 'sol', 'vue', 'svelte', 'dockerfile',
  'gitignore', 'srt', 'vtt',
]);

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function categoryOf(e: Pick<Entry, 'name'>): Category {
  return extToCategory[extOf(e.name)] ?? 'other';
}

export function previewKind(e: Entry): PreviewKind {
  const ext = extOf(e.name);
  if (officeMime[ext]) return 'office';
  if (ext === 'pdf') return 'pdf';
  if (textExt.has(ext) || e.mime?.startsWith('text/')) return 'text';
  const cat = categoryOf(e);
  if (cat === 'image' && !['raw', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'tif', 'tiff'].includes(ext)) return 'image';
  if (cat === 'video') return 'video';
  if (cat === 'audio') return 'audio';
  return 'other';
}

export function mimeOf(e: Entry): string {
  return officeMime[extOf(e.name)] ?? (e.mime || 'application/octet-stream');
}

export function iconFor(e: Entry): Icon {
  if (e.isDir) return Folder;
  const ext = extOf(e.name);
  if (['xls', 'xlsx', 'ods', 'csv', 'numbers'].includes(ext)) return FileSpreadsheet;
  if (['ppt', 'pptx', 'odp', 'key'].includes(ext)) return Presentation;
  if (['doc', 'docx', 'odt', 'rtf', 'pages', 'pdf'].includes(ext)) return FileType;
  if (textExt.has(ext)) return ['txt', 'md', 'log'].includes(ext) ? FileText : FileCode;
  switch (categoryOf(e)) {
    case 'image':
      return ImageIcon;
    case 'video':
      return Film;
    case 'audio':
      return Music;
    case 'archive':
      return Archive;
    default:
      return FileIcon;
  }
}

/** Label pendek ekstensi untuk badge, mis. "XLSX". */
export function extLabel(e: Entry): string {
  const ext = extOf(e.name);
  return ext ? ext.slice(0, 5).toUpperCase() : 'FILE';
}

export const categoryLabels: Record<Category, string> = {
  image: 'Foto',
  video: 'Video',
  audio: 'Audio',
  document: 'Dokumen',
  archive: 'Arsip',
  other: 'Lainnya',
};

// Warna kategori untuk grafik (urutan tetap, divalidasi untuk buta warna di permukaan cream).
// "Lainnya" memakai abu netral karena merupakan sisa/fold, bukan identitas.
export const categoryColors: Record<Category, string> = {
  image: '#e2652a',
  video: '#2a78d6',
  audio: '#1baf7a',
  document: '#eda100',
  archive: '#6250d6',
  other: '#9a9a8a',
};

const extMime: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', mkv: 'video/x-matroska', webm: 'video/webm',
  '3gp': 'video/3gpp', avi: 'video/x-msvideo', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac',
  wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/opus', pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', zip: 'application/zip',
};

/** Tebak MIME dari ekstensi nama file (untuk sumber yang tidak menyediakan MIME). */
export function mimeFromName(name: string): string | undefined {
  return extMime[extOf(name)];
}
