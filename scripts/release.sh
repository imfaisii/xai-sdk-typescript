#!/usr/bin/env bash
# Tag the current package.json version and push to origin so GitHub Actions
# publishes to npm + creates a GitHub Release.
#
# Usage:
#   ./scripts/release.sh           # tag v$(package.json version) and push
#   ./scripts/release.sh 0.1.2     # set version first, then tag + push
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "${1:-}" != "" ]]; then
  NEW_VERSION="$1"
  if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    echo "Invalid version: $NEW_VERSION (expected semver like 0.1.2)"
    exit 1
  fi
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.version = process.argv[1];
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  " "$NEW_VERSION"
  node -e '
    const fs = require("fs");
    const p = "src/version.ts";
    const next = process.argv[1];
    const s = fs.readFileSync(p, "utf8");
    const out = s.replace(/(export const VERSION = ")[^"]+(";)/, `$1${next}$2`);
    if (out === s) { console.error("Could not find VERSION in " + p); process.exit(1); }
    fs.writeFileSync(p, out);
  ' "$NEW_VERSION"
  echo "Bumped version to $NEW_VERSION"
fi

VERSION="$(node -p "require('./package.json').version")"
SRC_VERSION="$(node -p "require('fs').readFileSync('src/version.ts','utf8').match(/VERSION\\s*=\\s*\\\"([^\\\"]+)\\\"/)[1]")"
if [[ "$VERSION" != "$SRC_VERSION" ]]; then
  echo "package.json ($VERSION) != src/version.ts ($SRC_VERSION). Fix before releasing."
  exit 1
fi

TAG="v${VERSION}"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag $TAG already exists locally."
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  git add package.json src/version.ts
  # include any other staged intent only if version bump files changed
  git add -u package.json src/version.ts 2>/dev/null || true
  if [[ -n "$(git status --porcelain package.json src/version.ts)" ]]; then
    git commit -m "chore: release ${TAG}"
  fi
fi

# Ensure version commit is included even if user already committed
git tag -a "$TAG" -m "Release ${TAG}"
echo "Created tag $TAG"

git push origin HEAD
git push origin "$TAG"
echo "Pushed $TAG — GitHub Actions will publish npm + GitHub Release."
echo "Ensure repo secret NPM_TOKEN is set: Settings → Secrets → Actions"
