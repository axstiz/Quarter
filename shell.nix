# Nix-окружение для проекта (в т.ч. для тестов без ручного LD_LIBRARY_PATH):
#   nix-shell --run "pytest tests/ -q"
# или один раз после клонирования:
#   git config core.hooksPath .githooks   # хуки сами выставят LD_LIBRARY_PATH
with import <nixpkgs> { };
mkShell {
  buildInputs = [
    zlib
    stdenv.cc.cc.lib
    uv
    openspec
  ];
  shellHook = ''
    export LD_LIBRARY_PATH="${
      lib.makeLibraryPath [ zlib stdenv.cc.cc.lib ]
    }''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  '';
}
