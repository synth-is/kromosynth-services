#!/usr/bin/env bash
# Watch evolution run logs for user preferences and MQ activity.
# Usage:
#   ./scripts/watch-user-prefs.sh <runId>
#   ./scripts/watch-user-prefs.sh              # auto-detects if only one run exists

set -euo pipefail

LOGS_DIR="$(cd "$(dirname "$0")/.." && pwd)/logs"

if [[ $# -ge 1 ]]; then
  RUN_ID="$1"
else
  # Auto-detect: pick the most recently modified combined log
  LATEST=$(ls -t "$LOGS_DIR"/*.combined.log 2>/dev/null | head -1)
  if [[ -z "$LATEST" ]]; then
    echo "No log files found in $LOGS_DIR" >&2
    exit 1
  fi
  RUN_ID=$(basename "$LATEST" .combined.log)
  echo "Auto-detected run: $RUN_ID"
fi

LOG_FILE="$LOGS_DIR/${RUN_ID}.combined.log"

if [[ ! -f "$LOG_FILE" ]]; then
  echo "Log file not found: $LOG_FILE" >&2
  echo "Available runs:"
  ls "$LOGS_DIR"/*.combined.log 2>/dev/null | xargs -I{} basename {} .combined.log | sed 's/^/  /'
  exit 1
fi

echo "Watching: $LOG_FILE"
echo "Filtering for: user preferences, evaluation augmentation, MQ, parent selection"
echo "---"

tail -f "$LOG_FILE" | grep --line-buffered -iE \
  "User Preferences Cache|User Preference Eval|\[UserPrefEval\]|user preferences|userPrefs:|Parent selection:|user_preferences|MQ\]|Cached .* genomes from|numberOfParentGenomes"
