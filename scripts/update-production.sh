#!/usr/bin/env bash
# Run as the same deployment user that owns this application's PM2 process.
set -Eeuo pipefail

# Parse the whole workflow before git pull can replace this file on disk.
main() {
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != "--yes" ) ]]; then
  echo "Usage: bash scripts/update-production.sh [--yes]" >&2
  exit 2
fi

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd -- "$project_dir"
# Non-interactive Bash does not normally load nvm from the user's shell profile.
if [[ -z "${NVM_DIR:-}" ]]; then
  if [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
    export NVM_DIR="$XDG_CONFIG_HOME/nvm"
  else
    export NVM_DIR="$HOME/.nvm"
  fi
fi
[[ -s "$NVM_DIR/nvm.sh" ]] || { echo "nvm is not installed for this user. Install nvm and Node 24 first, or set NVM_DIR to its installation directory." >&2; exit 1; }
# nvm versions may reference unset shell variables; restore strict mode afterward.
set +u
if ! source "$NVM_DIR/nvm.sh" --no-use; then
  echo "Could not load nvm." >&2
  exit 1
fi
if ! nvm use 24; then
  echo "Node 24 is unavailable. Run nvm install 24 as this deployment user, then retry." >&2
  exit 1
fi
set -u
for tool in git node npm pm2 flock; do
  command -v "$tool" >/dev/null || { echo "Required command missing: $tool" >&2; exit 1; }
done
node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) { console.error("Expected Node 24 after nvm use 24."); process.exit(1); }'
[[ -f .env ]] || { echo "Missing .env; configure this deployment first." >&2; exit 1; }
[[ "$(git rev-parse --show-toplevel)" == "$project_dir" ]] || { echo "Run from the application repository." >&2; exit 1; }
exec 9>"$(git rev-parse --git-path server-check-update.lock)"
flock -n 9 || { echo "Another update is already running." >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "Working tree is not clean. Commit or preserve local changes before updating." >&2; exit 1; }
git rev-parse --abbrev-ref '@{upstream}' >/dev/null

echo "This update briefly stops Server Check, installs/builds dependencies, and applies pending database migrations."
echo "Back up the database and review pending migrations before continuing. No automatic rollback is attempted."
if [[ "${1:-}" != "--yes" ]]; then
  read -r -p "Backup prepared and ready to update? Type yes: " confirmation
  [[ "$confirmation" == "yes" ]] || { echo "Update cancelled."; exit 1; }
fi

phase="pull"
trap 'echo "Update failed during $phase. Do not restart against a partially migrated schema; inspect the error and repair before rerunning. The app may remain stopped." >&2' ERR
git pull --ff-only

ecosystem="ecosystem.config.cjs"
[[ ! -f ecosystem.local.config.cjs ]] || ecosystem="ecosystem.local.config.cjs"
app_name="$(node - "$ecosystem" <<'NODE'
const path = require('node:path');
const config = require(path.resolve(process.argv[2]));
const apps = config.apps;
if (!Array.isArray(apps) || apps.length !== 1 || !apps[0].name ||
    apps[0].instances !== 1 || apps[0].exec_mode !== 'fork' || apps[0].watch !== false) {
  throw new Error('The update ecosystem must contain exactly one named app, instances: 1, exec_mode: fork, watch: false.');
}
if (path.resolve(apps[0].cwd) !== process.cwd() || apps[0].script !== 'dist/server/server/index.js') {
  throw new Error('Keep cwd at the repository root and script at dist/server/server/index.js.');
}
if (apps[0].env?.NODE_ENV !== 'production' || Object.keys(apps[0].env ?? {}).some(key => key !== 'NODE_ENV') || apps[0].env_production) {
  throw new Error('Keep NODE_ENV: production in env; configure all other application settings in .env.');
}
process.stdout.write(apps[0].name);
NODE
)"
echo "Updating PM2 app: $app_name (using $ecosystem)"

phase="stop"
if pm2 describe "$app_name" >/dev/null 2>&1; then
  pm2 stop "$app_name"
fi
phase="dependency installation and build"
# postinstall builds both server and client. Explicitly allow lifecycle scripts.
npm ci --include=dev --ignore-scripts=false
phase="database migrations"
npm run migrate
phase="PM2 start/restart"
pm2 startOrRestart "$ecosystem" --only "$app_name" --update-env
phase="readiness verification"
node --input-type=module <<'NODE'
import { loadConfig } from './dist/server/server/config.js';
const config = loadConfig();
const host = config.host === '0.0.0.0' ? '127.0.0.1' : config.host === '::' ? '::1' : config.host;
const url = `http://${host.includes(':') ? `[${host}]` : host}:${config.port}/api/v1/health/ready`;
let ready = false;
for (let attempt = 0; attempt < 15; attempt++) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (response.ok && (await response.json()).status === 'ready') { ready = true; break; }
  } catch { /* Allow the new process time to connect and listen. */ }
  await new Promise(resolve => setTimeout(resolve, 2000));
}
if (!ready) { console.error('Readiness check failed. Inspect the application PM2 logs.'); process.exit(1); }
console.log('Backend and database readiness verified.');
NODE
phase="PM2 persistence"
pm2 save
echo "Update complete: $(git rev-parse --short HEAD)"
}
main "$@"
