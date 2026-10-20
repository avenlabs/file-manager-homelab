// Tiruan expo-file-system untuk Node, dengan penyuntikan gangguan jaringan.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';

export enum UploadType { BINARY_CONTENT = 0, MULTIPART = 1 }

const toPath = (u: string) => u.replace(/^file:\/\//, '');

export class Directory {
  path: string;
  constructor(parent: Directory | string, name?: string) {
    this.path = path.join(typeof parent === 'string' ? toPath(parent) : parent.path, name ?? '');
  }
  create() { fs.mkdirSync(this.path, { recursive: true }); }
}

export const Paths = { cache: new Directory((globalThis as any).__CACHE_DIR__) };

class Handle {
  fd: number; offset: number | null = 0;
  constructor(p: string) { this.fd = fs.openSync(p, 'r'); }
  async readBytes(len: number) {
    const buf = Buffer.alloc(len);
    const n = fs.readSync(this.fd, buf, 0, len, this.offset ?? 0);
    this.offset = (this.offset ?? 0) + n;
    return new Uint8Array(buf.subarray(0, n));
  }
  close() { fs.closeSync(this.fd); }
}

export class File {
  path: string;
  constructor(a: Directory | string, name?: string) {
    this.path = typeof a === 'string' ? toPath(a) : path.join(a.path, name!);
  }
  get uri() { return 'file://' + this.path; }
  get exists() { return fs.existsSync(this.path); }
  get size() { return this.exists ? fs.statSync(this.path).size : 0; }
  delete() { fs.rmSync(this.path, { force: true }); }
  create() { fs.writeFileSync(this.path, ''); }
  open() { return new Handle(this.path); }
  async write(bytes: Uint8Array) { fs.writeFileSync(this.path, bytes); }
  createUploadTask(url: string, opts: any) { return new UploadTask(this.path, url, opts); }
}

// faults: { [namaFile]: (nomorTask) => 'drop' | 'stall' | 'ok' }
const counters = new Map<string, number>();

export class UploadTask {
  state = 'idle';
  private req?: http.ClientRequest;
  private rejectFn?: (e: Error) => void;
  constructor(private file: string, private url: string, private opts: any) {}

  cancel() {
    if (this.state !== 'active') return;
    this.state = 'cancelled';
    this.req?.destroy();
    this.rejectFn?.(new Error('Upload was cancelled'));
  }
  release() {}

  uploadAsync(): Promise<{ status: number; body: string; headers: Record<string, string> }> {
    this.state = 'active';
    const data = fs.readFileSync(this.file);
    const faults = (globalThis as any).__FAULTS__ ?? {};
    const name = Object.keys(faults).find((n) => this.file.includes(n));
    const n = name ? (counters.get(name) ?? 0) + 1 : 0;
    if (name) counters.set(name, n);
    const mode: string = name ? faults[name](n) : 'ok';
    (globalThis as any).__LOG__?.push(`${name ?? path.basename(this.file)}#${n}:${mode}`);

    return new Promise((resolve, reject) => {
      this.rejectFn = reject;
      const u = new URL(this.url);
      const req = http.request(
        { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: this.opts.httpMethod,
          headers: { ...this.opts.headers, 'Content-Length': data.length } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => { if (this.state === 'active') { this.state = 'completed'; resolve({ status: res.statusCode!, body, headers: {} }); } });
        },
      );
      this.req = req;
      req.on('error', (e) => { if (this.state === 'active') { this.state = 'error'; reject(new Error('The network connection was lost.')); } });
      const piece = 256 * 1024;
      let sent = 0;
      const pump = () => {
        if (this.state !== 'active') return;
        if (mode === 'dead') { req.destroy(); return; } // koneksi mati total, tidak ada byte terkirim
        if (mode !== 'ok' && sent >= data.length / 2) {
          if (mode === 'drop') { req.destroy(); return; }
          return; // stall: berhenti mengirim tanpa menutup koneksi
        }
        if (sent >= data.length) { req.end(); return; }
        const chunk = data.subarray(sent, sent + piece);
        sent += chunk.length;
        req.write(chunk, () => { this.opts.onProgress?.({ bytesSent: sent, totalBytes: data.length }); setImmediate(pump); });
      };
      pump();
    });
  }
}
