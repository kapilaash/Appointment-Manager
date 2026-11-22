#!/bin/sh
# Run screenshot + accessibility checks inside the official Playwright Linux image so
# results are identical on every developer machine and in CI.
#   sh scripts/visual-tests.sh                      # compare against approved images
#   sh scripts/visual-tests.sh --update-snapshots   # approve the current rendering
set -eu

cd "$(dirname "$0")/.."
version="$(node -p "require('./package-lock.json').packages['node_modules/@playwright/test'].version")"
image="mcr.microsoft.com/playwright:v${version}-noble"
# Git Bash on Windows needs a Windows-style path for the bind mount.
workdir="$(pwd -W 2>/dev/null || pwd)"

MSYS_NO_PATHCONV=1 docker run --rm --ipc=host \
  -v "${workdir}:/work" \
  -v chess-academy-visual-node-modules:/work/node_modules \
  -w /work \
  -e CI="${CI:-}" \
  -e PLAYWRIGHT_FRONTEND_ONLY=1 \
  "$image" \
  sh -c 'hash="$(sha256sum package-lock.json | cut -d " " -f 1)";
         if [ "$(cat node_modules/.lock-hash 2>/dev/null)" != "$hash" ]; then
           npm ci --no-audit --no-fund && echo "$hash" > node_modules/.lock-hash;
         fi;
         npx playwright test --project=visual "$@"' -- "$@"
