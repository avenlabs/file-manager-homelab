import { JSDOM } from 'jsdom';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useUploads, type PickedFile, type UploadSummary } from '../../src/useUploads';
import { CasaOSProvider } from '../../src/providers/casaos';

const { window } = new JSDOM('<div id="root"></div>');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
Object.assign(globalThis as any, { window, document: window.document });

const API = process.env.API!;
const DATA = process.env.DATA!;
const SRC = process.env.SRC!;
const token = (await (await fetch(API + '/api/login', { method: 'POST', body: JSON.stringify({ password: 'demo123' }) })).json()).token;
const session = { baseUrl: API, token };
const casa = new CasaOSProvider('casa', 'CasaOS', session);
const target = { sourceId: 'casa', adapter: casa.uploader, dir: '/Upload', label: 'CasaOS / Upload' };

let hook: ReturnType<typeof useUploads>;
let settled: UploadSummary | null = null;
function Probe() {
  hook = useUploads(undefined, (s) => (settled = s));
  return null;
}
createRoot(window.document.getElementById('root')!).render(createElement(Probe));
await new Promise((r) => setTimeout(r, 50));

const f = (name: string, size?: number): PickedFile => ({ uri: 'file://' + SRC + '/' + name, name, size });
const sha = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const t0 = performance.now();
hook!.enqueue(
  [f('kecil.jpg'), f('besar.bin'), f('macet.bin'), f('rusak.bin'), f('putus.bin'), f('hilang.mov'), f('sudah-ada.jpg'), f('raksasa.bin', 2 ** 52), f('akhir.jpg')],
  target,
);
while (!settled) await new Promise((r) => setTimeout(r, 100));
const secs = ((performance.now() - t0) / 1000).toFixed(1);

const ok = (c: boolean, m: string) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const byName = Object.fromEntries(hook!.items.map((i) => [i.name, i]));
for (const i of hook!.items) console.log(`  ${i.name.padEnd(14)} ${i.status.padEnd(8)} ${i.error ?? ''}`);
console.log('  urutan task:', (globalThis as any).__LOG__.join(' '));
const same = (n: string) => fs.existsSync(DATA + '/Upload/' + n) && sha(DATA + '/Upload/' + n) === sha(SRC + '/' + n);
ok(byName['kecil.jpg'].status === 'done' && same('kecil.jpg'), 'file kecil terupload utuh');
ok(byName['besar.bin'].status === 'done' && same('besar.bin'), 'file besar (3 potongan) tetap utuh walau koneksi putus di potongan ke-2');
ok(byName['macet.bin'].status === 'done' && same('macet.bin'), 'potongan macet dibatalkan watchdog lalu dilanjutkan');
ok(byName['rusak.bin'].status === 'error' && /sudah dicoba 5x/.test(byName['rusak.bin'].error ?? ''), 'file yang terus gagal dilewati setelah 5x + ada alasan');
ok(byName['putus.bin'].status === 'done' && same('putus.bin'), 'koneksi putus-nyambung di setiap potongan: tetap selesai karena lanjut dari byte terakhir');
ok(byName['hilang.mov'].status === 'error' && /tidak ditemukan/.test(byName['hilang.mov'].error ?? ''), 'file yang tidak ada di HP langsung gagal dengan alasan');
ok(byName['sudah-ada.jpg'].status === 'skipped' && !fs.existsSync(DATA + '/Upload/sudah-ada (1).jpg'), 'file yang sudah ada dilewati tanpa duplikat');
ok(byName['raksasa.bin'].status === 'error' && /penuh/.test(byName['raksasa.bin'].error ?? ''), 'disk penuh → gagal cepat tanpa retry, alasan jelas');
ok(byName['akhir.jpg'].status === 'done' && same('akhir.jpg'), 'antrian tetap lanjut sampai file terakhir');
ok(settled!.failed.length === 3 && settled!.done === 5 && settled!.skipped === 1, `ringkasan: ${settled!.done} selesai, ${settled!.skipped} dilewati, ${settled!.failed.length} gagal`);
console.log(`  waktu: ${secs} detik (waktu dipercepat 20x → setara ±${Math.round(Number(secs) * 20)} detik nyata)`);

// Retry file yang gagal setelah gangguan hilang: lanjut dari byte terakhir.
(globalThis as any).__FAULTS__ = {};
settled = null;
const before = fs.readdirSync(DATA + '/.casa-files/uploads').length;
hook!.retryFailed();
while (!settled) await new Promise((r) => setTimeout(r, 100));
ok(hook!.items.find((i) => i.name === 'rusak.bin')!.status === 'done' && same('rusak.bin'), `coba lagi: rusak.bin berhasil (sisa sesi upload sebelum retry: ${before})`);
ok(settled!.failed.length === 2, `retry yang gagal seketika tetap memicu ringkasan (masih gagal: ${settled!.failed.map((x) => x.name).join(', ')})`);
ok(fs.readdirSync(DATA + '/.casa-files/uploads').length === 0, `tidak ada sisa sesi upload di server setelah selesai (sebelum retry: ${before} file)`);
process.exit();
