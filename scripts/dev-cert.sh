#!/usr/bin/env bash
# Self-signed TLS cert for local nginx (10.0.2.2 = host as seen from the Android emulator).
set -euo pipefail
dir="$(dirname "$0")/../infra/nginx/certs"
mkdir -p "$dir"
[[ -f "$dir/dev.key" ]] && exit 0
openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=dukaan.local" \
  -addext "subjectAltName=DNS:localhost,DNS:dukaan.local,IP:10.0.2.2,IP:127.0.0.1" \
  -keyout "$dir/dev.key" -out "$dir/dev.crt" 2>/dev/null
echo "wrote $dir/dev.{crt,key}"
