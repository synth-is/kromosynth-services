#!/usr/bin/env bash
set -euo pipefail

# synth.is deployment script
# Usage:
#   ./deploy.sh              Pull all repos, build frontend, reload all PM2 services
#   ./deploy.sh <service>    Pull and restart a single service (e.g. ./deploy.sh kromosynth-recommend)
#   ./deploy.sh --pull-only  Pull all repos without restarting services
#   ./deploy.sh --status     Show PM2 process status

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SYNTH_ROOT="${SYNTH_ROOT:-$(dirname "$SCRIPT_DIR")}"
ECOSYSTEM="${SCRIPT_DIR}/pm2/ecosystem.config.js"

# Repos that need to be pulled for production services.
# Order: core library first, then services, then frontend last (depends on core).
REPOS=(
  kromosynth              # core library (dependency of cli, render, etc.)
  kromosynth-mq
  kromosynth-recommend
  kromosynth-auth
  kromosynth-render
  kromosynth-cli
  kromosynth-evaluate
  kromosynth-vi
  kromosynth-evoruns
  kromosynth-services
  umami                   # analytics (umami-sqlite)
  kromosynth-desktop      # frontend — pulled last, built after all deps
)

# Repos with Node.js dependencies (check package-lock.json for changes)
NODE_REPOS=(
  kromosynth
  kromosynth-mq
  kromosynth-recommend
  kromosynth-auth
  kromosynth-render
  kromosynth-cli
  kromosynth-vi
  kromosynth-evoruns
  kromosynth-desktop
)

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()   { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()  { echo -e "${YELLOW}[deploy]${NC} $*"; }
error() { echo -e "${RED}[deploy]${NC} $*"; }

pull_repo() {
  local repo="$1"
  local repo_dir="${SYNTH_ROOT}/${repo}"

  if [ ! -d "${repo_dir}/.git" ]; then
    warn "Skipping ${repo} — not a git repo at ${repo_dir}"
    return 0
  fi

  log "Pulling ${repo}..."
  if ! git -C "${repo_dir}" pull --ff-only 2>&1; then
    error "Failed to pull ${repo} (diverged history?). Skipping."
    return 1
  fi
}

install_deps() {
  local repo="$1"
  local repo_dir="${SYNTH_ROOT}/${repo}"

  # Skip if no package-lock.json
  [ -f "${repo_dir}/package-lock.json" ] || return 0

  # Check if package-lock.json changed in the last pull
  if git -C "${repo_dir}" diff HEAD@{1} --quiet -- package-lock.json 2>/dev/null; then
    log "  ${repo}: package-lock.json unchanged, skipping npm install"
    return 0
  fi

  log "  ${repo}: package-lock.json changed, running npm install..."
  (cd "${repo_dir}" && npm install --production) || {
    error "  npm install failed for ${repo}"
    return 1
  }
}

install_python_deps() {
  local evaluate_dir="${SYNTH_ROOT}/kromosynth-evaluate"

  [ -d "${evaluate_dir}" ] || return 0

  # Check if requirements changed
  if git -C "${evaluate_dir}" diff HEAD@{1} --quiet -- requirements.txt 2>/dev/null; then
    log "  kromosynth-evaluate: requirements.txt unchanged, skipping pip install"
    return 0
  fi

  local venv_pip="${evaluate_dir}/.venv/bin/pip"
  if [ ! -f "${venv_pip}" ]; then
    warn "  Python venv not found at ${evaluate_dir}/.venv — skipping pip install"
    return 0
  fi

  log "  kromosynth-evaluate: requirements.txt changed, running pip install..."
  "${venv_pip}" install -r "${evaluate_dir}/requirements.txt" || {
    error "  pip install failed for kromosynth-evaluate"
    return 1
  }
}

build_frontend() {
  local web_dir="${SYNTH_ROOT}/kromosynth-desktop/packages/web"

  if [ ! -d "${web_dir}" ]; then
    warn "Frontend directory not found at ${web_dir}, skipping build"
    return 0
  fi

  log "Building frontend..."
  (cd "${web_dir}" && npm run build) || {
    error "Frontend build failed"
    return 1
  }
  log "Frontend built successfully"
}

deploy_all() {
  log "Starting full deployment from ${SYNTH_ROOT}"
  echo ""

  # Pull all repos
  local pull_failures=0
  for repo in "${REPOS[@]}"; do
    pull_repo "${repo}" || ((pull_failures++))
  done

  if [ "${pull_failures}" -gt 0 ]; then
    warn "${pull_failures} repo(s) failed to pull (see above)"
  fi
  echo ""

  # Install Node.js dependencies where needed
  log "Checking Node.js dependencies..."
  for repo in "${NODE_REPOS[@]}"; do
    install_deps "${repo}" || true
  done
  echo ""

  # Install Python dependencies if needed
  log "Checking Python dependencies..."
  install_python_deps || true
  echo ""

  # Build frontend
  build_frontend || {
    error "Frontend build failed — services will still be reloaded"
  }
  echo ""

  if [ "${1:-}" = "--pull-only" ]; then
    log "Pull-only mode — skipping PM2 reload"
    return 0
  fi

  # Reload PM2 (zero-downtime rolling restart)
  log "Reloading PM2 services..."
  pm2 reload "${ECOSYSTEM}" --update-env || {
    error "PM2 reload failed"
    return 1
  }

  # Save PM2 state for boot persistence
  pm2 save || warn "pm2 save failed"
  echo ""

  log "Deployment complete"
  pm2 list
}

deploy_single() {
  local service="$1"

  # Find which repo this service belongs to
  local repo=""
  case "${service}" in
    kromosynth-mq)                    repo="kromosynth-mq" ;;
    kromosynth-recommend)             repo="kromosynth-recommend" ;;
    kromosynth-pocketbase|kromosynth-auth) repo="kromosynth-auth" ;;
    kromosynth-render-preview|kromosynth-render-float-*) repo="kromosynth-render" ;;
    kromosynth-variation-breeding)    repo="kromosynth-cli" ;;
    kromosynth-features-breeding-*|kromosynth-clap-breeding) repo="kromosynth-evaluate" ;;
    kromosynth-vi)                    repo="kromosynth-vi" ;;
    kromosynth-evoruns)               repo="kromosynth-evoruns" ;;
    umami)                            repo="umami" ;;
    *)
      error "Unknown service: ${service}"
      echo "Available services:"
      pm2 list --no-color 2>/dev/null | grep -E 'kromosynth|umami' || true
      return 1
      ;;
  esac

  log "Deploying single service: ${service} (repo: ${repo})"

  pull_repo "${repo}" || {
    error "Pull failed — aborting"
    return 1
  }

  install_deps "${repo}" || true

  if [ "${repo}" = "kromosynth-evaluate" ]; then
    install_python_deps || true
  fi

  log "Restarting ${service}..."
  pm2 restart "${service}" --update-env || {
    error "pm2 restart failed for ${service}"
    return 1
  }

  pm2 save || warn "pm2 save failed"
  log "Deployed ${service} successfully"
}

# --- Main ---

case "${1:-}" in
  --status)
    pm2 list
    ;;
  --pull-only)
    deploy_all --pull-only
    ;;
  --help|-h)
    echo "Usage:"
    echo "  ./deploy.sh              Full deploy: pull, build, reload"
    echo "  ./deploy.sh <service>    Deploy single PM2 service"
    echo "  ./deploy.sh --pull-only  Pull all repos without restarting"
    echo "  ./deploy.sh --status     Show PM2 process status"
    echo "  ./deploy.sh --help       Show this help"
    ;;
  "")
    deploy_all
    ;;
  *)
    deploy_single "$1"
    ;;
esac
