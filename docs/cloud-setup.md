# Setup Google Drive & Dropbox

Casa Files memakai OAuth resmi (PKCE, tanpa client secret di app). Kredensial diisi sebagai
environment variable **saat build**; tanpa itu, pilihan Google Drive / Dropbox di "Tambah sumber"
tampil nonaktif ("Belum dikonfigurasi di build ini").

| Variable | Untuk |
|---|---|
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google Drive di iPhone (dan cadangan untuk Android) |
| `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` | Google Drive di Android |
| `EXPO_PUBLIC_DROPBOX_APP_KEY` | Dropbox (iPhone & Android) |

Nilai-nilai ini bukan rahasia (client ID / app key publik), jadi aman ada di dalam app.

## Google Drive

1. Buka [Google Cloud Console](https://console.cloud.google.com/) → buat project baru.
2. **APIs & Services → Library** → aktifkan **Google Drive API**.
3. **OAuth consent screen** → User type *External* → isi nama app & email.
   - Scopes: `openid`, `email`, `https://www.googleapis.com/auth/drive`.
   - Selama status *Testing*, tambahkan akun Google kamu (dan keluarga) di **Test users** (maks. 100).
4. **Credentials → Create credentials → OAuth client ID**:
   - **iOS**: Bundle ID `com.joywibowo.casafiles` → salin Client ID ke `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
   - **Android**: Package `com.joywibowo.casafiles`, SHA-1 dari keystore EAS
     (`npx eas-cli@latest credentials -p android` → lihat SHA1 Fingerprint). Di *Advanced settings*
     aktifkan **Custom URI scheme**. Salin Client ID ke `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`.
     Jika opsi custom URI scheme tidak tersedia, kosongkan variable Android — app memakai client ID iOS.

Redirect URI dibuat otomatis dari client ID (`com.googleusercontent.apps.<id>:/oauthredirect`) dan
didaftarkan ke app oleh `app/app.config.js` saat build.

**Batasan Google yang perlu diketahui**

- Selama consent screen berstatus *Testing*, Google membuat **refresh token kedaluwarsa setiap 7 hari**
  → user perlu menghubungkan ulang Google Drive seminggu sekali (app akan memberi tahu).
- Scope `drive` (akses penuh) termasuk *restricted*: untuk dipakai publik (lebih dari 100 user / tanpa
  batas 7 hari) app harus lolos verifikasi Google, termasuk security assessment.
- Dokumen Google (Docs/Sheets/Slides) tidak bisa diunduh mentah; app membukanya di aplikasi Google.

## Dropbox

1. Buka [Dropbox App Console](https://www.dropbox.com/developers/apps) → **Create app**.
2. *Scoped access* → *Full Dropbox* → beri nama app.
3. Tab **Permissions**: centang `files.metadata.read`, `files.content.read`, `files.content.write`,
   `account_info.read` → Submit.
4. Tab **Settings → OAuth 2 → Redirect URIs**: tambahkan `casafiles://oauth/dropbox`.
5. Salin **App key** ke `EXPO_PUBLIC_DROPBOX_APP_KEY`.

App dalam *Development* mode bisa dipakai hingga 500 user; ajukan *Production* jika butuh lebih.

## Mengisi variable saat build (EAS)

Cara paling mudah: simpan di EAS (sekali saja), lalu build seperti biasa.

```bash
cd app
npx eas-cli@latest env:create --environment preview --visibility plaintext \
  --name EXPO_PUBLIC_DROPBOX_APP_KEY --value <app-key>
npx eas-cli@latest env:create --environment preview --visibility plaintext \
  --name EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID --value <client-id-ios>
npx eas-cli@latest env:create --environment preview --visibility plaintext \
  --name EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID --value <client-id-android>

npx eas-cli@latest build -p android --profile preview
```

Untuk development lokal, isi file `app/.env.local` (tidak di-commit):

```
EXPO_PUBLIC_DROPBOX_APP_KEY=...
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=...
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=...
```
