#!/usr/bin/env bash
# Full release build: web app + CLI bundle.
# Safe to run from any directory — resolves repo root from script location.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "→ Building web app…"
pnpm --filter @vole/web build

echo "→ Bundling CLI…"
pnpm --filter vole-agent build

echo "→ Copying web artifacts into CLI dist…"
# Must run after tsup (clean:true wipes dist/ before bundling)
WEB_DIST="apps/web/dist"
CLI_WEB="apps/cli/dist/web"
rm -rf "$CLI_WEB"
mkdir -p "$CLI_WEB/client"
cp "$WEB_DIST/server.js" "$CLI_WEB/server.js"
# Use tar pipe to copy client assets — avoids macOS cp xattr failures under set -e
(cd "$WEB_DIST/client" && tar cf - .) | (cd "$CLI_WEB/client" && tar xf -)

echo "→ Running bundle smoke tests…"
SKIP_BUILD=1 pnpm run check:bundle

echo "→ Done. Publish with: cd apps/cli && npm publish --access public"
