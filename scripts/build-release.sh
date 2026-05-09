#!/usr/bin/env bash
# Full release build: web app + CLI bundle.
# Run from the repo root. Output: apps/cli/dist/ — ready to publish.
set -euo pipefail

echo "→ Building web app…"
pnpm --filter @vole/web build

echo "→ Copying web artifacts into CLI dist…"
WEB_DIST="apps/web/dist"
CLI_WEB="apps/cli/dist/web"
rm -rf "$CLI_WEB"
mkdir -p "$CLI_WEB"
cp "$WEB_DIST/server.js" "$CLI_WEB/server.js"
cp -r "$WEB_DIST/client"  "$CLI_WEB/client"

echo "→ Bundling CLI…"
pnpm --filter vole build

echo "→ Done. Publish with: cd apps/cli && npm publish --access public"
