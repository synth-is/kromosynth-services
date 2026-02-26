# synth.is Production Deployment Guide

## Architecture Overview

```
  Internet → Cloudflare (SSL) → port 80 → NAT → Mac Mini:8080 (nginx)
                                                      │
                    ┌─────────────────────────────────┤
                    │                                  │
              Static files                    Reverse proxy
          (synth.is frontend)                      │
                              ┌─────────┬──────────┼──────────┬────────────┐
                              │         │          │          │            │
                        api.synth.is auth.synth.is preview    render    analytics
                        (port 3004)  (port 3002)  .synth.is  .synth.is .synth.is
                                                  (3000, WS) (3001/5/  (3100)
                                                              6/7, LB)
```

All services managed by PM2. Auto-start on boot via launchd.

## Subdomains & Ports

| Domain | Service | Port | Protocol |
|--------|---------|------|----------|
| `synth.is` | Static frontend (Vite build) | — | HTTP (nginx serves files) |
| `api.synth.is` | kromosynth-recommend | 3004 | HTTP |
| `auth.synth.is` | kromosynth-auth | 3002 | HTTP |
| `preview.synth.is` | kromosynth-render-preview | 3000 | WebSocket |
| `render.synth.is` | kromosynth-render-float 1–4 | 3001, 3005, 3006, 3007 | WebSocket (load balanced) |
| `analytics.synth.is` | Umami (umami-sqlite) | 3100 | HTTP |

Internal services (not exposed via nginx):

| Service | Port |
|---------|------|
| kromosynth-mq | 3003 |
| kromosynth-evoruns | 4004 |
| kromosynth-pocketbase | 8090 |
| kromosynth-variation-breeding | 49071 |
| kromosynth-features-breeding 1/2 | 61061, 61062 |
| kromosynth-clap-breeding | 32051 |

## Prerequisites

On the Mac Mini production server:

```bash
# Node.js (v18+ for services, v20 for render)
# Install via nvm or directly
brew install nvm
nvm install 18
nvm install 20

# Python 3.10+ with virtual environment
brew install python@3.10

# Infrastructure
brew install redis
brew install neo4j

# Process manager
npm install -g pm2

# Reverse proxy
brew install nginx
```

## Initial Server Setup

### 1. Clone all repositories

```bash
# Set your root directory
export SYNTH_ROOT=~/Developer/apps/synth.is
mkdir -p "$SYNTH_ROOT"
cd "$SYNTH_ROOT"

# Clone each repo (update URLs to your Bitbucket/GitHub repos)
git clone <url> kromosynth
git clone <url> kromosynth-mq
git clone <url> kromosynth-recommend
git clone <url> kromosynth-auth
git clone <url> kromosynth-render
git clone <url> kromosynth-cli
git clone <url> kromosynth-evaluate
git clone <url> kromosynth-vi
git clone <url> kromosynth-evoruns
git clone <url> kromosynth-services
git clone <url> kromosynth-desktop
```

### 2. Install dependencies

```bash
# Node.js repos
for repo in kromosynth kromosynth-mq kromosynth-recommend kromosynth-auth \
            kromosynth-render kromosynth-cli kromosynth-vi kromosynth-evoruns \
            kromosynth-desktop; do
  (cd "$SYNTH_ROOT/$repo" && npm install)
done

# Python virtual environment
cd "$SYNTH_ROOT/kromosynth-evaluate"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
deactivate
```

### 3. Configure environment files

Each service has its own `.env` file. Create them on the server — **never commit secrets to git**.

Key `.env` files to configure:
- `kromosynth-recommend/.env` — Neo4j credentials, MQ URL, JWT secret
- `kromosynth-auth/.env` — PocketBase URL, JWT secret (must match recommend), admin credentials
- `kromosynth-mq/.env` — Redis host/port
- `kromosynth-evoruns/.env` — PORT=4004, directory paths
- `umami/.env` — DATABASE_URL, APP_SECRET (see Umami setup below)

### 4. Set up PocketBase (authentication)

PocketBase provides the user authentication database. Its binary and data live within `kromosynth-auth/`.

```bash
# 1. Download PocketBase binary (macOS ARM64)
# From https://pocketbase.io/docs/ — place at:
#   $SYNTH_ROOT/kromosynth-auth/pocketbase/pocketbase

# 2. Start PocketBase (will create pocketbase_data/ directory)
cd "$SYNTH_ROOT/kromosynth-auth"
npm run pocketbase:start
# Serves on http://127.0.0.1:8090

# 3. Create admin account (first time only)
# Visit http://localhost:8090/_/ in a browser
# Create admin account with the email/password from kromosynth-auth/.env:
#   POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD

# 4. Initialize the users collection with custom fields
npm run pocketbase:setup
# Creates the 'users' auth collection with fields:
#   displayName, isAnonymous, preferences, stats,
#   subscriptionTier, hasClaimedFreeTrial, trialExpiresAt, originalTier
```

**Backup:** The `pocketbase_data/` directory contains the SQLite database (`data.db`). Include it in your backup strategy.

### 5. Set up Umami Analytics (umami-sqlite)

Self-hosted, cookieless, GDPR-compliant analytics using [umami-sqlite](https://github.com/Maxime-J/umami-sqlite) — a community fork that uses SQLite instead of PostgreSQL.

```bash
# 1. Download pre-built release
cd "$SYNTH_ROOT"
# Download from https://github.com/Maxime-J/umami-sqlite/releases
# Extract to $SYNTH_ROOT/umami/

# 2. Configure environment
cat > "$SYNTH_ROOT/umami/.env" << 'EOF'
DATABASE_URL=file:./umami.db
APP_SECRET=<generate-a-random-string>
PORT=3100
DISABLE_TELEMETRY=1
CLIENT_IP_HEADER=X-Forwarded-For
EOF

# 3. Initialize database
cd "$SYNTH_ROOT/umami"
npx prisma migrate deploy

# 4. Start Umami (PM2 will handle this, but for first-time setup)
npm start
# Visit http://localhost:3100 — default login: admin / umami

# 5. Create a website in Umami admin panel
# Go to Settings → Websites → Add website
# Name: synth.is, Domain: synth.is
# Copy the Website ID

# 6. Update frontend with the Website ID
# Edit kromosynth-desktop/packages/web/index.html
# Replace data-website-id="UMAMI_WEBSITE_ID" with the actual ID
```

**Maintenance:** Run `node sqlite-vacuum.js` periodically to optimize the SQLite database. Can be scheduled via cron or PM2's `cron_restart` option.

**Frontend integration:** Already complete — 77+ analytics events are instrumented in `src/utils/analytics.js` and integrated into 20+ components. All calls gracefully no-op if Umami isn't loaded.

### 6. Set SYNTH_ROOT in shell profile

Add to `~/.zshrc` (or `~/.bashrc`):

```bash
export SYNTH_ROOT="$HOME/Developer/apps/synth.is"
```

### 7. Build the frontend

```bash
cd "$SYNTH_ROOT/kromosynth-desktop/packages/web"
npm run build
```

### 8. Install nginx config

```bash
# Option A: Replace the default nginx config
cp "$SYNTH_ROOT/kromosynth-services/nginx/nginx.conf" /usr/local/etc/nginx/servers/synth.conf

# Option B: Include from the default config
# Add to /usr/local/etc/nginx/nginx.conf inside the http {} block:
#   include /path/to/kromosynth-services/nginx/nginx.conf;

# Update the 'root' path in the synth.is server block to match your SYNTH_ROOT

# Test config
nginx -t

# Reload
sudo nginx -s reload
```

### 9. Start infrastructure services

```bash
brew services start redis
brew services start neo4j
```

### 10. Start PM2 and all services

```bash
cd "$SYNTH_ROOT/kromosynth-services"
pm2 start pm2/ecosystem.config.js
pm2 save
```

### 11. Enable auto-start on boot

```bash
# PM2 startup — generates a launchd plist
pm2 startup launchd
# Follow the instructions it prints (run the launchctl command)

# Infrastructure services auto-start via brew services (already registered)
# nginx auto-starts via brew services (already registered)
```

### 12. Verify

```bash
# Check all PM2 processes
pm2 list

# Check logs
pm2 logs --lines 20

# Check health endpoint
curl http://localhost:3004/health

# Reboot and verify everything comes back
sudo reboot
# After reboot:
pm2 list
```

## Deploying Updates

### Full deployment (all services)

From the Mac Mini:
```bash
cd $SYNTH_ROOT/kromosynth-services
./deploy.sh
```

From your dev machine:
```bash
ssh macmini 'cd ~/Developer/apps/synth.is/kromosynth-services && ./deploy.sh'
```

### Single service deployment

```bash
./deploy.sh kromosynth-recommend
```

### Pull only (no restart)

```bash
./deploy.sh --pull-only
```

### Check status

```bash
./deploy.sh --status
# or
pm2 list
```

## deploy.sh Behavior

1. `git pull --ff-only` each repo (safe — refuses if history diverged)
2. `npm install` only if `package-lock.json` changed
3. `pip install` only if `requirements.txt` changed
4. `npm run build` for the frontend (Vite production build)
5. `pm2 reload` (zero-downtime rolling restart, not `pm2 restart`)
6. `pm2 save` (update boot dump)

**The script never overwrites `.env` files.** Secrets are configured once on the server.

## Monitoring & Troubleshooting

```bash
# Live logs for all services
pm2 logs

# Logs for a specific service
pm2 logs kromosynth-recommend

# Resource usage
pm2 monit

# Restart a stuck service
pm2 restart kromosynth-recommend

# Full restart of everything
pm2 reload pm2/ecosystem.config.js --update-env

# Check nginx error log
tail -f /usr/local/var/log/nginx/error.log
```

## Rollback

If a deploy introduces a bug:

```bash
# Roll back a specific repo to previous commit
cd $SYNTH_ROOT/kromosynth-recommend
git log --oneline -5      # find the good commit
git checkout <commit-hash>

# Restart the affected service
pm2 restart kromosynth-recommend
pm2 save
```

## Notes

- **Cloudflare** handles SSL termination. nginx receives plain HTTP on port 8080.
- **render.synth.is** load-balances across 4 float rendering workers via nginx upstream.
- **COOP/COEP headers** are set by nginx for the frontend (required for SharedArrayBuffer/WASM).
- **CLAP_DEVICE=mps** in the ecosystem config uses Apple Silicon GPU. Change to `cuda` or `cpu` on a Linux/cloud server.
- The `recommend.synth.is` subdomain is kept as an alias for `api.synth.is` in nginx for backwards compatibility.
