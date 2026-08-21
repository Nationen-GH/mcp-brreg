#!/usr/bin/env bash
# Install dependencies and start the MCP server.
#
#   ./build-and-run.sh            # stdio (for a local MCP client)
#   ./build-and-run.sh http       # HTTP on $PORT, /mcp
#   ./build-and-run.sh check      # typecheck, tests, build, smoke test
set -euo pipefail

cd "$(dirname "$0")"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { printf "${YELLOW}%s${NC}\n" "$*" >&2; }
ok()    { printf "${GREEN}%s${NC}\n" "$*" >&2; }
fatal() { printf "${RED}Error: %s${NC}\n" "$*" >&2; exit 1; }

MODE="${1:-stdio}"

command -v bun >/dev/null 2>&1 || fatal "bun is not installed. See https://bun.sh/ (curl -fsSL https://bun.sh/install | bash)"
info "Using bun $(bun --version)"

info "Installing dependencies..."
if [ -f bun.lock ]; then
  bun install --frozen-lockfile
else
  bun install
fi
ok "Dependencies ready."

case "$MODE" in
  check)
    info "Typechecking..."; bun run typecheck
    info "Checking formatting..."; bun run format:check
    info "Running tests..."; bun test
    info "Building..."; bun run build
    info "Smoke-testing the compiled server under Node..."; node scripts/smoke-stdio.mjs
    ok "All checks passed."
    ;;
  http)
    if [ -z "${AUTH_TOKEN:-}" ]; then
      info "AUTH_TOKEN is unset - the server will accept unauthenticated requests."
      info "Generate one with: AUTH_TOKEN=\$(openssl rand -hex 32) ./build-and-run.sh http"
    fi
    info "Starting on http://${HOST:-0.0.0.0}:${PORT:-3000} (endpoints: /mcp, /health)"
    exec env TRANSPORT=http bun run src/index.ts
    ;;
  stdio)
    info "Starting on stdio. Waiting for an MCP client on stdin/stdout..."
    exec env TRANSPORT=stdio bun run src/index.ts
    ;;
  *)
    fatal "Unknown mode '$MODE'. Use: stdio | http | check"
    ;;
esac
