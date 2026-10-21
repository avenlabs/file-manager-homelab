// Tes upload ke Google Drive & Dropbox (server tiruan sesuai protokol resmi) lewat mesin upload asli.
import { JSDOM } from 'jsdom';
import * as fs from 'node:fs';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useUploads, type PickedFile, type UploadSummary, type UploadTarget } from '../../src/useUploads';
import { GDriveProvider } from '../../src/providers/gdrive';
import { DropboxProvider } from '../../src/providers/dropbox';
import { storage } from '../../src/storage';
import { dbx, drive, startFakeCloud } from './fake-cloud';

const { window } = new JSDOM('<div id="root"></div>');
Object.assign(globalThis as any, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: false });

const SRC = process.env.SRC!;
const port = await startFakeCloud();
const base = `http://127.0.0.1:${port}`;
const rewrite = (u: string) =>
  u
    .replace('https://www.googleapis.com', `${base}/g`)
    .replace('https://api.dropboxapi.com/2', `${base}/dbx/2`)
    .replace('https://content.dropboxapi.com/2', `${base}/dbx/2`);
(globalThis as any).__REWRITE__ = rewrite;
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => realFetch(rewrite(String(input)), init)) as typeof fetch;

const farFuture = Date.now() + 365 * 24 * 3600 * 1000;
await storage.set('casa-files-token-gd', JSON.stringify({ accessToken: 'token-lama', refreshToken: 'r1', expiresAt: farFuture }));
await storage.set('casa-files-token-db', JSON.stringify({ accessToken: 'token-db', refreshToken: 'r2', expiresAt: farFuture }));
drive.expireTokenOnce = true; // token Google ditolak sekali → harus refresh otomatis

const gd = new GDriveProvider('gd', 'Google Drive', 'saya@gmail.com');
const db = new DropboxProvider('db', 'Dropbox', 'saya@dropbox.com');
const toDrive: UploadTarget = { sourceId: 'gd', adapter: gd.uploader, dir: 'root', label: 'Google Drive / My Drive' };
const toDbx: UploadTarget = { sourceId: 'db', adapter: db.uploader, dir: '', label: 'Dropbox' };

let hook: ReturnType<typeof useUploads>;
let settled: UploadSummary | null = null;
function Probe() {
  hook = useUploads(undefined, (s) => (settled = s));
  return null;
}
createRoot(window.document.getElementById('root')!).render(createElement(Probe));
await new Promise((r) => setTimeout(r, 50));
const waitSettled = async () => {
  while (!settled) await new Promise((r) => setTimeout(r, 50));
  const s = settled;
  settled = null;
  return s;
};

const f = (name: string): PickedFile => ({ uri: 'file://' + SRC + '/' + name, name });
const src = (name: string) => fs.readFileSync(SRC + '/' + name);
const ok = (c: boolean, m: string) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m);
  if (!c) process.exitCode = 1;
};

const nonAscii = 'Liburan – café ☕.jpg';
let moved = false;
hook!.enqueue([f('besar-drive.bin'), f('kecil.jpg')], toDrive);
hook!.enqueue([f('besar-dbx.bin'), f(nonAscii)], toDbx);
// "Pindah" antar sumber: prepare = ambil file ke lokal, after = hapus file asal.
hook!.enqueue(
  [{ name: 'dari-casaos.mov', prepare: async () => ({ uri: 'file://' + SRC + '/dari-casaos.mov' }), after: async () => void (moved = true) }],
  toDbx,
);
const s1 = await waitSettled();
for (const i of hook!.items) console.log(`  ${i.name.padEnd(22)} ${i.status.padEnd(8)} → ${i.destLabel} ${i.error ?? ''}`);
console.log('  urutan task:', (globalThis as any).__LOG__.join(' '));

const driveFile = (n: string) => drive.files.find((x) => x.name === n)?.data;
ok(!!driveFile('besar-drive.bin')?.equals(src('besar-drive.bin')), 'Drive: file 40MB utuh walau koneksi putus di potongan ke-2 (lanjut via 308 Range)');
ok(!!driveFile('kecil.jpg')?.equals(src('kecil.jpg')), 'Drive: file kecil utuh');
ok(((globalThis as any).__REFRESHED__ ?? 0) >= 1, 'Drive: token kedaluwarsa (401) diperbarui otomatis lalu diulang');
ok(!!dbx.files.get('/besar-dbx.bin')?.equals(src('besar-dbx.bin')), 'Dropbox: file 40MB utuh walau koneksi putus (lanjut via incorrect_offset)');
ok(!!dbx.files.get('/' + nonAscii.toLowerCase())?.equals(src(nonAscii)), 'Dropbox: nama file non-ASCII ("Liburan – café ☕.jpg") tersimpan benar');
ok(dbx.badHeaders === 0, 'Dropbox: header Dropbox-API-Arg selalu ASCII');
ok(!!dbx.files.get('/dari-casaos.mov') && moved, 'Pindah antar sumber: file tersalin lalu file asal dihapus');
ok(s1.failed.length === 0 && s1.done === 5, `ringkasan batch 1: ${s1.done} selesai, ${s1.failed.length} gagal`);

// Upload ulang file yang sama → dilewati (idempotent), tanpa duplikat.
hook!.enqueue([f('kecil.jpg')], toDrive);
hook!.enqueue([f(nonAscii)], toDbx);
const s2 = await waitSettled();
ok(s2.skipped === 2 && s2.done === 0, `upload ulang dilewati (Drive & Dropbox): ${s2.skipped} dilewati`);
ok(drive.files.filter((x) => x.name === 'kecil.jpg').length === 1, 'Drive: tidak ada duplikat');
process.exit();
