# Casa Files

File manager mobile (iPhone & Android) untuk upload, melihat, dan mengelola foto/video/file di storage homelab CasaOS.

```
┌──────────────┐   HTTPS/HTTP (LAN / Tailscale)   ┌──────────── CasaOS ────────────┐
│  App Expo    │ ───────────────────────────────▶ │ casa-files-server (Docker, Go) │
│ iOS/Android  │   REST + token                   │   /data  ⇢  disk 1.5TB         │
└──────────────┘                                  └────────────────────────────────┘
```

- `server/` — API Go (stdlib saja, tanpa dependency), jalan sebagai container di CasaOS.
- `app/` — aplikasi Expo SDK 58 (React Native + TypeScript).

## Fitur

- Browse folder, breadcrumb, pull-to-refresh, info kapasitas disk
- Upload multi foto & video dari galeri (file asli HEIC/HEVC, tanpa kompresi), kamera, atau file apa pun
- Antrian upload (2 paralel), progress, cancel, tetap jalan saat app di-minimize (background session)
- Upload di-stream ke disk → video ukuran GB aman; nama bentrok otomatis jadi `foto (1).jpg`
- Preview gambar & streaming video (HTTP Range), share / simpan ke Photos
- Folder baru, rename, hapus
- Auth password → token HMAC (default 30 hari), proteksi path traversal & symlink escape

## 1. Deploy server di CasaOS

1. Cek lokasi disk 1.5TB kamu di CasaOS (Storage Manager), mis. `/DATA` atau `/media/HDD1`.
2. Copy folder `server/` ke CasaOS (scp / Samba), lalu via SSH:

   ```bash
   cd server
   # edit docker-compose.yml: APP_PASSWORD, TOKEN_SECRET (openssl rand -hex 32), dan path volume
   docker compose up -d --build
   curl http://localhost:8088/api/health   # {"status":"ok"}
   ```

   Container akan muncul di dashboard CasaOS. (Alternatif: build & push image ke Docker Hub/GHCR,
   lalu pakai **App Store → Custom Install → Import** dengan compose yang menunjuk ke image tersebut.)

3. Volume `- /path/disk/kamu:/data` menentukan folder mana yang bisa diakses app. Semua di luar `/data` tidak bisa disentuh.

### Akses dari luar rumah (disarankan: Tailscale)

Jangan expose port 8088 langsung ke internet. Pilihan:

- **Tailscale** (ada di App Store CasaOS): install di CasaOS + iPhone/Android, lalu akses `http://<ip-tailscale>:8088`.
  Untuk HTTPS: `tailscale serve --bg 8088` → `https://<nama-mesin>.<tailnet>.ts.net`.
- **Cloudflare Tunnel**: dapat domain HTTPS publik. Perhatikan limit body upload 100MB di plan gratis — kurang cocok untuk video besar.

## 2. Menjalankan app (development)

```bash
cd app
npm install
npx expo start
```

Karena app memakai modul native (video, background upload, secure store), gunakan **development build**, bukan Expo Go:

```bash
npm i -g eas-cli && eas login
eas build -p android --profile development   # atau -p ios
```

## 3. Install ke HP

| Platform | Cara | Biaya |
|---|---|---|
| Android | `npm run build:android` → hasil `.apk`, download & install langsung (izinkan "unknown sources") | Gratis |
| iPhone (opsi A) | Apple Developer Program → `npm run build:ios` (ad hoc, daftarkan UDID via `eas device:create`) atau TestFlight lewat `eas submit` | $99/tahun |
| iPhone (opsi B) | Mac + Xcode + Apple ID gratis: `npx expo run:ios --device` | Gratis, tapi app expired tiap 7 hari |

## API server

Semua endpoint (kecuali health & login) butuh `Authorization: Bearer <token>` atau `?token=`.

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/health` | cek server |
| POST | `/api/login` | `{"password"}` → `{"token","expiresAt"}` |
| GET | `/api/storage` | `{total, free, used}` byte |
| GET | `/api/list?path=/Photos` | isi folder (`&hidden=1` untuk dotfiles) |
| GET | `/api/file?path=...` | download/stream, dukung Range (`&download=1` untuk attachment) |
| POST | `/api/upload?path=/dir[&name=x.jpg]` | multipart/form-data |
| POST | `/api/mkdir` | `{"path"}` |
| POST | `/api/rename` | `{"from","to"}` |
| DELETE | `/api/delete?path=...` | hapus file/folder |

Env server: `APP_PASSWORD` (wajib), `TOKEN_SECRET`, `TOKEN_TTL_HOURS` (720), `STORAGE_ROOT` (`/data`), `PORT` (8088).

## Ide pengembangan berikutnya

- Thumbnail di sisi server (saat ini thumbnail list memuat gambar asli, di-cache di HP)
- Auto-backup galeri (seperti Google Photos) dengan `expo-media-library` + `expo-background-task`
- Upload resumable/chunked (tus) untuk koneksi tidak stabil
- Multi-user
