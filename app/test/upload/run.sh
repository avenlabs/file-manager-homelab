#!/usr/bin/env bash
# Tes ketahanan upload: hook useUploads asli + server Go asli, dengan gangguan jaringan tiruan
# (koneksi putus, macet, mati total, file hilang, disk penuh). Waktu dipercepat 20x.
#   cd app && npm run test:upload
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
PORT=$((20000 + RANDOM % 20000))
trap '[ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null; rm -rf "$WORK"' EXIT

mkdir -p "$WORK/src" "$WORK/data/Upload" "$WORK/cache"
mk() { head -c "$2" /dev/urandom >"$WORK/src/$1"; }
mk kecil.jpg 1048576; mk besar.bin 41943040; mk macet.bin 20971520; mk rusak.bin 5242880
mk putus.bin 6291456; mk sudah-ada.jpg 307200; mk raksasa.bin 10240; mk akhir.jpg 2097152
cp "$WORK/src/sudah-ada.jpg" "$WORK/data/Upload/"

(cd "$APP/../server" && go build -o "$WORK/server" .)
APP_PASSWORD=demo123 STORAGE_ROOT="$WORK/data" PORT=$PORT "$WORK/server" >"$WORK/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 50); do curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null && break; sleep 0.1; done

cd "$HERE"
npx esbuild run.tsx --bundle --platform=node --format=esm --outfile="$WORK/run.mjs" --jsx=automatic \
  --alias:expo-file-system=./mocks/expo-file-system.ts --alias:expo-keep-awake=./mocks/expo-keep-awake.ts \
  --alias:react-native=./mocks/react-native.ts --external:jsdom --banner:js="$(cat banner.js)" --log-level=warning
cp "$WORK/run.mjs" "$HERE/.run.mjs"   # dijalankan dari folder app agar jsdom ter-resolve
trap '[ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null; rm -rf "$WORK" "$HERE/.run.mjs"' EXIT
API="http://127.0.0.1:$PORT" DATA="$WORK/data" SRC="$WORK/src" CACHE="$WORK/cache" node "$HERE/.run.mjs"
