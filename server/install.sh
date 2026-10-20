#!/usr/bin/env bash
# Installer casa-files-server sebagai service systemd (tanpa Docker).
# Cocok untuk perangkat kecil seperti Jetson Nano / Raspberry Pi.
#
#   curl -fsSL https://raw.githubusercontent.com/avenlabs/file-manager-homelab/main/server/install.sh | sudo bash
#
# Atau dengan binary lokal:  sudo ./install.sh ./casa-files-server-linux-arm64
# Non-interaktif:            sudo APP_PASSWORD=... STORAGE_PATH=/DATA ./install.sh
set -euo pipefail

REPO="avenlabs/file-manager-homelab"
BIN="/usr/local/bin/casa-files-server"
CONF_DIR="/etc/casa-files"
ENV_FILE="$CONF_DIR/casa-files.env"
UNIT="/etc/systemd/system/casa-files.service"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "jalankan dengan sudo"
command -v systemctl >/dev/null || die "systemd tidak ditemukan"

case "$(uname -m)" in
  aarch64 | arm64) ARCH=arm64 ;;
  x86_64 | amd64) ARCH=amd64 ;;
  armv7l | armv6l) ARCH=armv7 ;;
  *) die "arsitektur $(uname -m) belum didukung" ;;
esac

# ---------- binary ----------
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
if [ -n "${1:-}" ]; then
  say "Memakai binary lokal: $1"
  cp "$1" "$TMP"
else
  URL="https://github.com/$REPO/releases/latest/download/casa-files-server-linux-$ARCH"
  say "Download $URL"
  curl -fL --retry 3 -o "$TMP" "$URL" || die "gagal download binary. Pastikan sudah ada release di https://github.com/$REPO/releases"
fi
# Pastikan yang terdownload benar-benar program (ELF), bukan halaman HTML.
[ "$(head -c 4 "$TMP" | od -An -c | tr -d ' ')" = '177ELF' ] || die "file bukan binary Linux (ELF)"

if systemctl is-active --quiet casa-files 2>/dev/null; then
  systemctl stop casa-files
fi
install -m 755 "$TMP" "$BIN"
say "Terpasang di $BIN"

# ---------- konfigurasi (hanya dibuat sekali, tidak ditimpa saat update) ----------
ask() { # ask <prompt> <default> [silent]
  local reply=""
  if [ -r /dev/tty ]; then
    if [ "${3:-}" = silent ]; then
      read -rsp "$1" reply </dev/tty; echo >&2
    else
      read -rp "$1" reply </dev/tty
    fi
  fi
  echo "${reply:-$2}"
}
quote() { local v=${1//\\/\\\\}; printf '"%s"' "${v//\"/\\\"}"; }

if [ ! -f "$ENV_FILE" ]; then
  PASSWORD="${APP_PASSWORD:-}"
  while [ -z "$PASSWORD" ]; do
    PASSWORD="$(ask 'Password untuk login dari app: ' '' silent)"
    [ -r /dev/tty ] || die "set APP_PASSWORD=... saat menjalankan installer"
  done
  STORAGE="${STORAGE_PATH:-$(ask 'Folder storage yang diakses app [/DATA]: ' /DATA)}"
  PORT_NUM="${PORT:-8088}"
  SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"

  mkdir -p "$CONF_DIR"
  umask 077
  cat >"$ENV_FILE" <<EOF
APP_PASSWORD=$(quote "$PASSWORD")
TOKEN_SECRET=$SECRET
STORAGE_ROOT=$(quote "$STORAGE")
PORT=$PORT_NUM
TOKEN_TTL_HOURS=720
EOF
  umask 022
  say "Konfigurasi dibuat: $ENV_FILE"
else
  say "Konfigurasi lama dipakai: $ENV_FILE"
fi

STORAGE="$(sed -n 's/^STORAGE_ROOT="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$ENV_FILE")"
PORT_NUM="$(sed -n 's/^PORT=//p' "$ENV_FILE")"
mkdir -p "$STORAGE"

# ---------- service ----------
# Tunggu disk eksternal ter-mount sebelum start (dilewati jika path mengandung spasi).
MOUNT_LINE=""
case "$STORAGE" in *" "*) ;; *) MOUNT_LINE="RequiresMountsFor=$STORAGE" ;; esac
cat >"$UNIT" <<EOF
[Unit]
Description=Casa Files server
After=network-online.target
Wants=network-online.target
$MOUNT_LINE

[Service]
EnvironmentFile=$ENV_FILE
ExecStart=$BIN
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable casa-files >/dev/null 2>&1
systemctl restart casa-files

say "Menunggu server siap..."
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT_NUM}/api/health" >/dev/null 2>&1; then
    IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    echo
    say "Casa Files berjalan."
    echo "    Alamat untuk app : ${IP:-<ip-server>}:${PORT_NUM}"
    echo "    Storage          : $STORAGE"
    echo "    Konfigurasi      : $ENV_FILE"
    echo "    Log              : journalctl -u casa-files -f"
    exit 0
  fi
  sleep 1
done
journalctl -u casa-files -n 30 --no-pager || true
die "server tidak merespons, cek log di atas"
