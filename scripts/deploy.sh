#!/usr/bin/env bash
# Safe update for a Linux server: builds the new version in its own folder while the old one keeps
# serving, tries it on a spare port, then switches with `pm2 reload` (no downtime). If the new version
# does not answer /api/health after the switch, it switches straight back.
#
# Folder layout under the base folder (default /opt/opl-tracker):
#   repo.git/            a copy of the git repository (only with --repo or REPO=)
#   releases/<time>-<id> one folder per version; the last 3 are kept for rollback
#   shared/.env.local    the settings, copied into every release (edit here, then deploy again)
#   shared/state/        files that must survive updates (sent-today stamps, backups)
#   current              link to the release that is running
#
# Usage:
#   scripts/deploy.sh --repo https://github.com/ORG/opl_tracker.git   first time from git (then just: scripts/deploy.sh)
#   scripts/deploy.sh --from /path/to/unzipped/opl_tracker            deploy a folder (no git needed)
#   scripts/deploy.sh --rollback                                      go back to the previous release
# Options: --base DIR, --ref BRANCH (default main), --port 3000, --prefix opl, --skip-tests.
# The same values can be put in <base>/deploy.env (REPO=, REF=, PORT=, PREFIX=).
# A test server beside the real one: --base /opt/opl-test --port 3100 --prefix opl-test
# (with its own shared/.env.local pointing at the test Supabase project).
set -euo pipefail
shopt -s nullglob

BASE=/opt/opl-tracker REF= REPO= FROM= PORT= PREFIX= ROLLBACK=0 SKIP_TESTS=0 TRIAL_PORT=
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE=$2; shift 2 ;;
    --repo) REPO=$2; shift 2 ;;
    --ref) REF=$2; shift 2 ;;
    --from) FROM=$2; shift 2 ;;
    --port) PORT=$2; shift 2 ;;
    --prefix) PREFIX=$2; shift 2 ;;
    --trial-port) TRIAL_PORT=$2; shift 2 ;;
    --rollback) ROLLBACK=1; shift ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    *) echo "Unknown option $1 (see --help)"; exit 2 ;;
  esac
done
BASE=$(mkdir -p "$BASE" && cd "$BASE" && pwd)
# Values from deploy.env fill in whatever was not given on the command line.
if [ -f "$BASE/deploy.env" ]; then
  # shellcheck disable=SC1091
  eval "$(grep -E '^(REPO|REF|PORT|PREFIX)=' "$BASE/deploy.env" | sed 's/^/CFG_/')"
fi
REPO=${REPO:-${CFG_REPO:-}} REF=${REF:-${CFG_REF:-main}} PORT=${PORT:-${CFG_PORT:-3000}} PREFIX=${PREFIX:-${CFG_PREFIX:-opl}}
TRIAL_PORT=${TRIAL_PORT:-$((PORT + 999))}
PM2=${PM2:-pm2}
APP="$PREFIX-tracker"

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nDEPLOY FAILED: %s\n' "$*" >&2; exit 1; }

mkdir -p "$BASE/releases" "$BASE/shared/state"
LOCK="$BASE/.deploy.lock"
mkdir "$LOCK" 2>/dev/null || die "another deploy is running (or crashed): remove $LOCK if not"
TRIAL_PID=
cleanup() { if [ -n "$TRIAL_PID" ]; then kill "$TRIAL_PID" 2>/dev/null || true; fi; rmdir "$LOCK" 2>/dev/null || true; }
trap cleanup EXIT

# Waits until http://127.0.0.1:PORT/api/health answers ok (from release $2 when given) $3 times in a row.
health() {
  local port=$1 want=${2:-} need=${3:-1} ok=0 body=
  for _ in $(seq 1 60); do
    body=$(curl -sS -m 5 "http://127.0.0.1:$port/api/health" 2>&1 || true)
    if printf '%s' "$body" | grep -q '"ok":true' &&
       { [ -z "$want" ] || printf '%s' "$body" | grep -q "\"release\":\"$want\""; }; then
      ok=$((ok + 1)); [ "$ok" -ge "$need" ] && { echo "    $body"; return 0; }
    else
      ok=0
    fi
    sleep 1
  done
  echo "    last answer: ${body:-none}"; return 1
}

# Points "current" at a release in one step (a new link renamed over the old one).
switch_to() {
  ln -sfn "$1" "$BASE/current.new"
  mv -Tf "$BASE/current.new" "$BASE/current"
}

pm2_apply() {
  export OPL_APP_DIR="$BASE/current" OPL_STATE_DIR="$BASE/shared/state" OPL_PORT="$PORT" OPL_PREFIX="$PREFIX"
  if "$PM2" describe "$APP" >/dev/null 2>&1; then
    "$PM2" reload "$BASE/current/ecosystem.config.js" --update-env >/dev/null || return 1
  else
    "$PM2" start "$BASE/current/ecosystem.config.js" >/dev/null || return 1
  fi
  "$PM2" save >/dev/null 2>&1 || true
}

PREV=$( [ -L "$BASE/current" ] && readlink -f "$BASE/current" || true)

if [ "$ROLLBACK" = 1 ]; then
  [ -n "$PREV" ] || die "nothing is deployed yet"
  TARGET=
  for d in "$BASE"/releases/*; do
    case "$d" in *.failed|*.rolled-back) continue ;; esac
    [ "$d" = "$PREV" ] && break
    TARGET=$d
  done
  [ -n "$TARGET" ] || die "there is no older release to go back to"
  say "Rolling back from $(basename "$PREV") to $(basename "$TARGET")"
  switch_to "$TARGET"; pm2_apply || true
  health "$PORT" "$(basename "$TARGET")" 3 || die "the old release does not answer either; check: $PM2 logs $APP"
  # The release we left would be chosen again by the next rollback; mark it so it is skipped.
  mv "$PREV" "$PREV.rolled-back"
  say "Now running $(basename "$TARGET")"
  exit 0
fi

# ── 1. Get the code ──
STAMP=$(date +%Y%m%d-%H%M%S)
if [ -n "$FROM" ]; then
  [ -f "$FROM/package.json" ] || die "$FROM is not the app folder (no package.json)"
  ID=folder; REL="$BASE/releases/$STAMP-$ID"
  say "Copying $FROM"
  mkdir -p "$REL"
  tar -C "$FROM" --exclude=./node_modules --exclude=./.next --exclude=./.env.local --exclude=./.git -cf - . | tar -C "$REL" -xf -
else
  [ -d "$BASE/repo.git" ] || { [ -n "$REPO" ] || die "first deploy: give --repo URL (or --from FOLDER)"; say "Cloning $REPO"; git clone --bare -q "$REPO" "$BASE/repo.git"; }
  [ -n "$REPO" ] && git -C "$BASE/repo.git" remote set-url origin "$REPO"
  say "Fetching $REF"
  git -C "$BASE/repo.git" fetch -q origin "+refs/heads/*:refs/heads/*" --prune
  SHA=$(git -C "$BASE/repo.git" rev-parse --verify "$REF^{commit}") || die "no branch or commit called $REF"
  ID=$(git -C "$BASE/repo.git" rev-parse --short "$SHA"); REL="$BASE/releases/$STAMP-$ID"
  mkdir -p "$REL"
  git -C "$BASE/repo.git" archive "$SHA" | tar -C "$REL" -xf -
fi
NAME=$(basename "$REL")
echo "$NAME" > "$REL/RELEASE"
# Before the switch: the site is untouched; the release is kept as <name>.failed for a look.
fail() {
  if [ -n "$TRIAL_PID" ]; then kill "$TRIAL_PID" 2>/dev/null || true; wait "$TRIAL_PID" 2>/dev/null || true; TRIAL_PID=; fi
  cd "$BASE"; mv "$REL" "$REL.failed"
  echo "    The site was not touched. Logs are in $REL.failed"
  die "$1"
}

if [ -f "$BASE/shared/.env.local" ]; then
  cp "$BASE/shared/.env.local" "$REL/.env.local"
elif [ -n "$PREV" ] && [ -f "$PREV/.env.local" ]; then
  cp "$PREV/.env.local" "$BASE/shared/.env.local"; cp "$PREV/.env.local" "$REL/.env.local"
else
  echo "    No $BASE/shared/.env.local: the app will run in demo mode (browser-only data)."
fi

# ── 2. Install and build (the running site is untouched) ──
cd "$REL"
if [ -n "$PREV" ] && [ -d "$PREV/node_modules" ] && cmp -s "$PREV/package-lock.json" package-lock.json; then
  say "Packages unchanged: copying them from the running release"
  cp -a "$PREV/node_modules" node_modules
else
  say "Installing packages (npm ci)"
  npm ci --no-audit --no-fund --loglevel=error || fail "npm ci failed"
fi
if [ "$SKIP_TESTS" = 0 ]; then
  say "Running the unit tests"
  npm test --silent >"$REL/test.log" 2>&1 || { tail -n 30 "$REL/test.log"; fail "unit tests failed (test.log)"; }
fi
say "Building"
npm run build >"$REL/build.log" 2>&1 || { tail -n 30 "$REL/build.log"; fail "build failed (build.log)"; }

# ── 3. Try it on a spare port ──
say "Trying the new version on port $TRIAL_PORT"
node node_modules/next/dist/bin/next start -p "$TRIAL_PORT" >"$REL/trial.log" 2>&1 &
TRIAL_PID=$!
health "$TRIAL_PORT" "$NAME" 1 || { tail -n 20 "$REL/trial.log"; fail "the new version did not pass its health check on port $TRIAL_PORT"; }
kill "$TRIAL_PID" 2>/dev/null; wait "$TRIAL_PID" 2>/dev/null || true; TRIAL_PID=

# ── 4. Switch with no downtime, and switch back if it goes wrong ──
say "Switching to $NAME"
switch_to "$REL"
if ! pm2_apply || ! health "$PORT" "$NAME" 3; then
  if [ -n "$PREV" ]; then
    say "The new version is not healthy on port $PORT: switching back to $(basename "$PREV")"
    switch_to "$PREV"; pm2_apply || true; health "$PORT" "$(basename "$PREV")" 1 || true
    mv "$REL" "$REL.failed"
  fi
  die "the new version did not pass the health check after the switch (see: $PM2 logs $APP)"
fi

# ── 5. Keep the last 3 releases (and the last 2 failed or rolled-back ones, for a look) ──
good=() bad=()
for d in "$BASE"/releases/*; do
  case "$d" in *.failed|*.rolled-back) bad+=("$d") ;; *) good+=("$d") ;; esac
done
for ((i = 0; i < ${#good[@]} - 3; i++)); do
  [ "${good[$i]}" = "$REL" ] || [ "${good[$i]}" = "$PREV" ] || rm -rf "${good[$i]}"
done
for ((i = 0; i < ${#bad[@]} - 2; i++)); do rm -rf "${bad[$i]}"; done
say "Done: $NAME is live on port $PORT. Go back with: $0 --base $BASE --rollback"
