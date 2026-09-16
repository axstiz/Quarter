#!/usr/bin/env bash
# Общая среда для хуков.
# На NixOS python-venv (numpy/pandas) требует libstdc++ и zlib, которых нет
# в системных путях: подбираем ELF64-версии библиотек из /nix/store.
# Установка хуков: git config core.hooksPath .githooks

nix_fix_ld() {
    [ -d /nix/store ] || return 0
    for lib in /nix/store/*gcc*lib/lib/libstdc++.so.6 /nix/store/*zlib*/lib/libz.so.1; do
        [ -e "$lib" ] || continue
        # ELFCLASS64 = байт 4 == 2
        if [ "$(head -c 5 "$lib" | tail -c 1 | od -An -tu1 | tr -d ' ')" = "2" ]; then
            dir="$(dirname "$lib")"
            case ":${LD_LIBRARY_PATH:-}:" in
                *":${dir}:"*) ;;
                *) export LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-}${LD_LIBRARY_PATH:+:}${dir}" ;;
            esac
        fi
    done
}
