#!/bin/bash
# Cloud sessions only: install deps and the binary the typescript-lsp plugin needs.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
npm install --no-audit --no-fund

# The LSP uses the project's own TypeScript from node_modules.
command -v typescript-language-server >/dev/null || npm install -g --no-audit --no-fund typescript-language-server
