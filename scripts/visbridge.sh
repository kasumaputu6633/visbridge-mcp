#!/usr/bin/env bash
# Launcher for the visbridge-mcp stdio server.
# Loads credentials from .env so the API key never has to be written into
# the MCP client config (.mcp.json / .cursor/mcp.json).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
cd "$ROOT"

set -a
# shellcheck disable=SC1091
if [ -f "$ROOT/.env" ]; then
  . "$ROOT/.env"
fi
set +a

exec node --import tsx "$ROOT/src/index.ts" "$@"
