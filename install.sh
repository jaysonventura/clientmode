#!/bin/sh
# Client Mode — one-line install for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/jaysonventura/clientmode/main/install.sh | sh
#
# What it does, in order:
#   1. uses Node >= 22.17 if you have it, otherwise downloads Node into ~/.client-mode/runtime
#      (checksum-verified against nodejs.org; nothing system-wide, no sudo);
#   2. downloads Client Mode into ~/.client-mode/src and installs its dependencies there;
#   3. runs `cm install`: the cm plugin for Claude Code, and the same rules and skills for Codex,
#      Gemini CLI and Cursor, with each host set to run without approval prompts;
#   4. puts `cm` on your PATH.
#
# Options, as environment variables:
#   CM_HOSTS=claude,codex   configure only these hosts (default: all four)
#   CM_NO_AUTONOMY=1        leave every host's permission settings unchanged
#   CM_REF=v2.0.0           install a tag or branch instead of main
#   CM_SOURCE_TARBALL=path  install from a local .tar.gz instead of downloading (used by CI)
#
# Remove everything again with: cm uninstall
set -eu

REPO="jaysonventura/clientmode"
REF="${CM_REF:-main}"
CM_HOME="${CM_HOME:-$HOME/.client-mode}"
NODE_VERSION="22.23.2"
BIN_DIR="$HOME/.local/bin"

say() { printf '%s\n' "$*"; }
fail() { printf '\nClient Mode install failed: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required but not installed"; }

need curl
need tar

# Node >= 22.17.0: node:sqlite is part of the controller.
node_ok() {
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=17)?0:1)' 2>/dev/null
}

sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

NODE=""
if command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then
  NODE="$(command -v node)"
  say "Using Node $("$NODE" --version) at $NODE"
elif [ -x "$CM_HOME/runtime/node/bin/node" ] && node_ok "$CM_HOME/runtime/node/bin/node"; then
  NODE="$CM_HOME/runtime/node/bin/node"
  say "Using Client Mode's Node $("$NODE" --version)"
else
  case "$(uname -s)" in
    Darwin) PLATFORM=darwin ;;
    Linux) PLATFORM=linux ;;
    *) fail "unsupported operating system: $(uname -s). On Windows use install.ps1." ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) ARCH=arm64 ;;
    x86_64|amd64) ARCH=x64 ;;
    *) fail "unsupported processor: $(uname -m)" ;;
  esac
  NAME="node-v$NODE_VERSION-$PLATFORM-$ARCH"
  say "Downloading Node v$NODE_VERSION (no system changes; it lives in $CM_HOME/runtime)..."
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$NAME.tar.gz" -o "$TMP/node.tar.gz" || fail "could not download Node"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt" || fail "could not download Node checksums"
  EXPECTED="$(awk -v f="$NAME.tar.gz" '$2 == f {print $1}' "$TMP/SHASUMS256.txt")"
  ACTUAL="$(sha256 "$TMP/node.tar.gz")"
  [ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] || fail "Node checksum mismatch (expected $EXPECTED, got $ACTUAL)"
  mkdir -p "$CM_HOME/runtime"
  rm -rf "$CM_HOME/runtime/node" "$CM_HOME/runtime/$NAME"
  tar -xzf "$TMP/node.tar.gz" -C "$CM_HOME/runtime"
  mv "$CM_HOME/runtime/$NAME" "$CM_HOME/runtime/node"
  NODE="$CM_HOME/runtime/node/bin/node"
fi
NODE_DIR="$(dirname "$NODE")"
PATH="$NODE_DIR:$PATH"
export PATH

say "Downloading Client Mode ($REF)..."
if [ -n "${CM_SOURCE_TARBALL:-}" ]; then
  cp "$CM_SOURCE_TARBALL" "$TMP/src.tar.gz"
else
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" -o "$TMP/src.tar.gz" || fail "could not download $REPO@$REF"
fi
mkdir -p "$TMP/src"
tar -xzf "$TMP/src.tar.gz" -C "$TMP/src" --strip-components=1
[ -f "$TMP/src/apps/cli/src/cm.ts" ] || fail "the download does not contain Client Mode"
mkdir -p "$CM_HOME"
rm -rf "$CM_HOME/src"
mv "$TMP/src" "$CM_HOME/src"

say "Installing dependencies..."
(cd "$CM_HOME/src" && npm ci --no-audit --no-fund --loglevel=error) || fail "npm ci failed in $CM_HOME/src"

set -- install --bin-dir "$BIN_DIR"
[ -n "${CM_HOSTS:-}" ] && set -- "$@" --host "$CM_HOSTS"
[ "${CM_NO_AUTONOMY:-}" = "1" ] && set -- "$@" --no-autonomy
say "Configuring your hosts..."
(cd "$CM_HOME/src" && CM_HOME="$CM_HOME" NODE_NO_WARNINGS=1 "$NODE" --import tsx apps/cli/src/cm.ts "$@") || fail "cm install did not finish"

# PATH for new terminals. Each line carries a marker so `cm uninstall` can take it out again.
MARKER="# client-mode:path"
LINE="export PATH=\"$BIN_DIR:\$PATH\" $MARKER"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    case "${SHELL:-}" in
      */zsh) RCS="$HOME/.zshrc" ;;
      */bash) RCS="$HOME/.bashrc $HOME/.bash_profile" ;;
      *) RCS="$HOME/.profile" ;;
    esac
    for RC in $RCS; do
      if [ ! -f "$RC" ] || ! grep -q "$MARKER" "$RC"; then
        printf '\n%s\n' "$LINE" >> "$RC"
        say "Added $BIN_DIR to PATH in $RC"
      fi
    done
    ;;
esac

say ""
say "Client Mode is installed."
MISSING=""
for HOST_CMD in claude codex gemini agent; do command -v "$HOST_CMD" >/dev/null 2>&1 || MISSING="$MISSING $HOST_CMD"; done
if [ -n "$MISSING" ]; then
  say "Not found on this machine:$MISSING. Their settings are ready; install any you use, then run: cm install"
fi
say "Open a new terminal (or run: export PATH=\"$BIN_DIR:\$PATH\"), then:"
say "  cm doctor                 check the install"
say "  cd your-project && cm     start your preferred host there"
say "Remove it with: cm uninstall"
