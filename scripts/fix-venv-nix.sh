#!/usr/bin/env bash
# Починка .venv на NixOS после `uv sync`: ДОБАВЛЯЕТ rpath (libstdc++/libz)
# к существующему rpath всех ELF-расширений (не стирая $ORIGIN и вендорные
# библиотеки из numpy.libs и т.п.). Идемпотентно; запускать после uv sync.
set -euo pipefail

[ -d .venv ] || { echo ".venv не найден; сначала uv sync"; exit 0; }

LIBSTDC=""
for d in $(find /nix/store -maxdepth 1 -type d -name "*gcc*lib" 2>/dev/null); do
  f="$d/lib/libstdc++.so.6"
  [ -e "$f" ] || continue
  if [ "2" = "$(head -c 5 "$f" | tail -c 1 | od -An -tu1 | tr -d ' ')" ]; then
    LIBSTDC="$d"
    break
  fi
done
LIBZ=""
for d in $(find /nix/store -maxdepth 1 -type d -name "*zlib*" 2>/dev/null); do
  f="$d/lib/libz.so.1"
  [ -e "$f" ] || continue
  if [ "2" = "$(head -c 5 "$f" | tail -c 1 | od -An -tu1 | tr -d ' ')" ]; then
    LIBZ="$d"
    break
  fi
done
[ -n "$LIBSTDC" ] && [ -n "$LIBZ" ] || { echo "nix-библиотеки ELF64 не найдены — не NixOS?"; exit 0; }

PATCH=${PATCH:-$(command -v patchelf || true)}
if [ -z "$PATCH" ]; then
  exec nix-shell -p patchelf --run "$0"
fi

cur=""  # leftover removed
find .venv -type f \( -name "*.so" -o -name "*.so.*" \) -print0 |
  while IFS= read -r -d '' so; do
    [ "2" = "$(head -c 5 "$so" | tail -c 1 | od -An -tu1 | tr -d ' ')" ] || continue
    existing=$("$PATCH" --print-rpath "$so" 2>/dev/null || true)
    # $ORIGIN сохраняем/восстанавливаем (вендорные .so из wheel'ов ищутся рядом)
    base=""
    case ":$existing:" in
      *"\$ORIGIN"*) base="$existing" ;;
      *) base='$ORIGIN:'$existing ;;
    esac
    want="$base:${LIBZ}/lib:${LIBSTDC}/lib"
    if [ "$existing" != "$want" ]; then
      "$PATCH" --set-rpath "$want" "$so" 2>/dev/null || true
    fi
  done
echo "OK: rpath дополнен (zlib=${LIBZ}, libstdc++=${LIBSTDC})"
