#!/usr/bin/env bash
# Push this repository's "About" metadata to GitHub.
#
# GitHub does not read the description, homepage or topics from any file in the
# repository — they are server-side settings. This script makes the repo the
# source of truth anyway: edit the values below, run it, and GitHub matches.
#
#   ./scripts/sync-github-metadata.sh          # apply
#   ./scripts/sync-github-metadata.sh --dry-run  # print what would change
#
# Requires the GitHub CLI, authenticated with admin rights on the repo:
#   gh auth login
#
# Note: this is deliberately NOT a GitHub Actions workflow. Changing repository
# settings needs the `administration: write` permission, which is not among the
# scopes a workflow's GITHUB_TOKEN can request — automating it would mean
# storing a long-lived admin PAT as a secret to set cosmetic metadata.
set -euo pipefail

cd "$(dirname "$0")/.."

REPO="Nationen-GH/mcp-server-brreg"

DESCRIPTION="MCP-server for Brønnøysundregistrene — norske foretak, underenheter, roller og næringskoder som verktøy for språkmodeller"
HOMEPAGE="https://github.com/Nationen-GH/mcp-server-brreg#readme"

# Lowercase, digits and hyphens only; GitHub allows at most 20.
TOPICS=(
  mcp
  model-context-protocol
  brreg
  bronnoysundregistrene
  enhetsregisteret
  norway
  norwegian
  open-data
  typescript
  bun
)

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { printf "${YELLOW}%s${NC}\n" "$*" >&2; }
ok()   { printf "${GREEN}%s${NC}\n" "$*" >&2; }
fatal() { printf "${RED}Error: %s${NC}\n" "$*" >&2; exit 1; }

command -v gh >/dev/null 2>&1 \
  || fatal "gh is not installed. See https://cli.github.com/"
gh auth status >/dev/null 2>&1 \
  || fatal "gh is not authenticated. Run: gh auth login"

info "Repository: $REPO"
info "Description: $DESCRIPTION"
info "Homepage:    $HOMEPAGE"
info "Topics:      ${TOPICS[*]}"

if [ "${1:-}" = "--dry-run" ]; then
  ok "Dry run - nothing changed."
  exit 0
fi

# --add-topic is additive, so pass the full set and let GitHub dedupe. Topics
# removed from the list above are not deleted; drop those by hand.
topic_args=()
for topic in "${TOPICS[@]}"; do
  topic_args+=(--add-topic "$topic")
done

gh repo edit "$REPO" \
  --description "$DESCRIPTION" \
  --homepage "$HOMEPAGE" \
  "${topic_args[@]}"

ok "Synced. Check: https://github.com/$REPO"
