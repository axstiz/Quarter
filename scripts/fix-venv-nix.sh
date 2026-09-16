#!/usr/bin/env bash
# Починка .venv на NixOS после `uv sync`.
# 1) ДОБАВЛЯЕТ rpath (libstdc++/zlib, только ELF64) ко всем ELF-расширениям.
# 2) ДОБАВЛЯЕТ абсолютный путь каждого вендорного каталога "*.libs" (numpy.libs и т.п.)
#    — это чинит загрузку (libscipy_openblas и прочих), потерянную раньше.
# Идемпотентно; запускать после каждого uv sync.
set -euo pipefail

[ -d .venv ] || { echo ".venv не найден; сначала uv sync"; exit 0; }

find_lib64() {
  local pattern="$1" testlib="$2" f d
  for d in $(find /nix/store -maxdepth 1 -type d -name "$pattern" 2>/dev/null); do
    f="$d/lib/$testlib"
    [ -e "$f" ] || continue
    if [ "2" = "$(head -c 5 "$f" | tail -c 1 | od -An -tu1 | tr -d ' ')" ]; then
      echo "$d/lib"
      return 0
    fi
  done
}

LIBSTDC=$(find_lib64 "*gcc*lib" libstdc++.so.6)
LIBZ=$(find_lib64 "*zlib*" libz.so.1)
[ -n "$LIBSTDC" ] && [ -n "$LIBZ" ] || { echo "nix-библиотеки ELF64 не найдены — не NixOS?"; exit 0; }

PATCH=${PATCH:-$(command -v patchelf || true)}
if [ -z "$PATCH" ]; then
  exec nix-shell -p patchelf --run "$0"
fi

# Все вендорные каталоги — абсолютные пути в общий rpath
VENDOR=""
while IFS= read -r d; do
  VENDOR="$VENDOR:$d"
done < <(find ".venv/lib" -type d -name "*.libs" 2>/dev/null)

find .venv -type f \( -name "*.so" -o -name "*.so.*" \) -print0 |
  while IFS= read -r -d '' so; do
    [ "2" = "$(head -c 5 "$so" | tail -c 1 | od -An -tu1 | tr -d ' ')" ] || continue
    existing=$("$PATCH" --print-rpath "$so" 2>/dev/null || true)
    base='$ORIGIN'
    if [ -n "$existing" ]; then base="$base:$existing"; fi
    want="$base${VENDOR}:${LIBZ}:${LIBSTDC}"
    if [ "$existing" != "$want" ]; then
      "$PATCH" --set-rpath "$want" "$so" 2>/dev/null || true
    fi
  done
echo "OK: rpath дополнен (zlib=$LIBZ, libstdc++=$LIBSTDC, vendor-libs=$VENDOR)"
