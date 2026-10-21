// Server tiruan Google Drive & Dropbox, mengikuti protokol upload resmi masing-masing:
// - Drive: resumable session (POST → Location; PUT Content-Range → 308 + Range / 200)
// - Dropbox: upload_session start/append_v2/finish (409 incorrect_offset + correct_offset)
import * as http from 'node:http';

type Stored = { name: string; parent: string; data: Buffer };
export const drive = { files: [] as Stored[], sessions: new Map<string, { name: string; parent: string; size: number; data: Buffer[]; got: number }>(), expireTokenOnce: false };
export const dbx = { files: new Map<string, Buffer>(), sessions: new Map<string, { data: Buffer[]; got: number }>(), badHeaders: 0 };
let seq = 0;

function body(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
    req.on('aborted', () => resolve(Buffer.concat(parts)));
  });
}

const json = (res: http.ServerResponse, code: number, obj: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
};

export function startFakeCloud(): Promise<number> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://x');
    const auth = req.headers.authorization ?? '';

    // ---------- Google Drive ----------
    if (url.pathname.startsWith('/g/')) {
      if (drive.expireTokenOnce && auth === 'Bearer token-lama') {
        drive.expireTokenOnce = false;
        return json(res, 401, { error: { message: 'Invalid Credentials' } });
      }
      if (req.method === 'GET' && url.pathname === '/g/drive/v3/files') {
        const q = url.searchParams.get('q') ?? '';
        const name = q.match(/name='((?:\\'|[^'])*)'/)?.[1]?.replace(/\\'/g, "'");
        const parent = q.match(/'([^']*)' in parents/)?.[1];
        const files = drive.files.filter((f) => (!name || f.name === name) && f.parent === parent);
        return json(res, 200, { files: files.map((f, i) => ({ id: `id${i}`, name: f.name, size: String(f.data.length), mimeType: 'application/octet-stream' })) });
      }
      if (req.method === 'POST' && url.pathname === '/g/upload/drive/v3/files') {
        const meta = JSON.parse((await body(req)).toString());
        const id = `s${++seq}`;
        drive.sessions.set(id, { name: meta.name, parent: meta.parents[0], size: Number(req.headers['x-upload-content-length']), data: [], got: 0 });
        return json(res, 200, {}, { Location: `http://127.0.0.1:${port}/drive-session/${id}` });
      }
    }
    if (url.pathname.startsWith('/drive-session/')) {
      const s = drive.sessions.get(url.pathname.split('/').pop()!);
      if (!s) return json(res, 404, { error: { message: 'Not found' } });
      const range = String(req.headers['content-range'] ?? '');
      const data = await body(req);
      const m = range.match(/bytes (\d+)-(\d+)\/(\d+)/);
      if (m) {
        const start = Number(m[1]);
        if (start !== s.got) return json(res, 400, { error: { message: 'Invalid range' } });
        s.data.push(data); // bisa parsial jika koneksi putus — sama seperti Drive asli
        s.got += data.length;
      }
      if (s.got >= s.size) {
        drive.files.push({ name: s.name, parent: s.parent, data: Buffer.concat(s.data) });
        drive.sessions.delete(url.pathname.split('/').pop()!);
        return json(res, 200, { id: 'done', name: s.name });
      }
      res.writeHead(308, s.got ? { Range: `bytes=0-${s.got - 1}` } : {});
      return res.end();
    }

    // ---------- Dropbox ----------
    if (url.pathname.startsWith('/dbx/')) {
      const argHeader = String(req.headers['dropbox-api-arg'] ?? '');
      if (/[^\x00-\x7f]/.test(argHeader)) dbx.badHeaders++;
      const arg = argHeader ? JSON.parse(argHeader) : null;
      const data = await body(req);
      const ep = url.pathname.replace('/dbx/2/', '');
      if (ep === 'files/get_metadata') {
        const { path } = JSON.parse(data.toString());
        const f = dbx.files.get(path.toLowerCase());
        return f ? json(res, 200, { '.tag': 'file', size: f.length }) : json(res, 409, { error_summary: 'path/not_found/..' });
      }
      if (ep === 'files/upload_session/start') {
        const id = `d${++seq}`;
        dbx.sessions.set(id, { data: [], got: 0 });
        return json(res, 200, { session_id: id });
      }
      if (ep === 'files/upload_session/append_v2') {
        const s = dbx.sessions.get(arg.cursor.session_id);
        if (!s) return json(res, 409, { error_summary: 'not_found/..' });
        if (arg.cursor.offset !== s.got) {
          return json(res, 409, { error_summary: 'incorrect_offset/..', error: { '.tag': 'incorrect_offset', correct_offset: s.got } });
        }
        s.data.push(data);
        s.got += data.length;
        return json(res, 200, null);
      }
      if (ep === 'files/upload_session/finish') {
        const s = dbx.sessions.get(arg.cursor.session_id);
        if (!s) return json(res, 409, { error_summary: 'lookup_failed/not_found/' });
        if (arg.cursor.offset !== s.got) {
          return json(res, 409, { error_summary: 'lookup_failed/incorrect_offset/', error: { '.tag': 'lookup_failed', lookup_failed: { '.tag': 'incorrect_offset', correct_offset: s.got } } });
        }
        dbx.files.set(arg.commit.path.toLowerCase(), Buffer.concat(s.data));
        dbx.sessions.delete(arg.cursor.session_id);
        return json(res, 200, { name: arg.commit.path.split('/').pop() });
      }
    }
    json(res, 404, { error: 'unknown ' + url.pathname });
  });
  let port = 0;
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as any).port;
      resolve(port);
    }),
  );
}
