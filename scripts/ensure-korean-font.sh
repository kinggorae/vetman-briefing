#!/usr/bin/env bash
set -u

# Hosted runners can occasionally hang while refreshing the Ubuntu package
# index. Font installation must not hold the entire build/deploy pipeline.
font_family() {
  fc-match -f '%{family}\n' "$1" 2>/dev/null | head -n 1 || true
}

has_korean_font() {
  local family
  family="$(font_family 'NanumGothic')"
  [[ "$family" == *Nanum* ]] && return 0
  family="$(font_family 'Noto Sans CJK KR')"
  [[ "$family" == *Noto* ]] && return 0
  return 1
}

if has_korean_font; then
  echo "Korean font already available"
  exit 0
fi

if command -v sudo >/dev/null 2>&1 && command -v timeout >/dev/null 2>&1; then
  # Keep the package operation bounded. A stale apt index is still preferable
  # to blocking a scheduled publication indefinitely; install will use it when
  # possible and the build continues with the runner's fallback fonts otherwise.
  timeout 120s sudo -n apt-get update \
    -o Acquire::Retries=1 \
    -o Acquire::http::Timeout=15 \
    -o Acquire::https::Timeout=15 || true
  if timeout 90s sudo -n env DEBIAN_FRONTEND=noninteractive \
      apt-get install -y --no-install-recommends fonts-nanum; then
    timeout 30s fc-cache -f || true
  fi
fi

if has_korean_font; then
  echo "Korean font installed"
else
  echo "::warning::Korean font unavailable; continuing without blocking the build/deploy"
fi
