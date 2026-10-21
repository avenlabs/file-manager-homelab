globalThis.__CACHE_DIR__ = process.env.CACHE;
globalThis.__LOG__ = [];
globalThis.__FAULTS__ = {
  'besar-drive.bin': (n) => (n === 2 ? 'drop' : 'ok'),
  'besar-dbx.bin': (n) => (n === 2 ? 'drop' : 'ok'),
};
{
  const SPEED = 20, start = Date.now(), realNow = Date.now.bind(Date), st = setTimeout, si = setInterval;
  Date.now = () => start + (realNow() - start) * SPEED;
  globalThis.setTimeout = (fn, ms = 0, ...a) => st(fn, ms / SPEED, ...a);
  globalThis.setInterval = (fn, ms = 0, ...a) => si(fn, ms / SPEED, ...a);
}
