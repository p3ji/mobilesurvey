#!/usr/bin/env bash
# Watchdog + publisher for the Phase 19 derivation drain (no_agent cron).
# - Restarts the extraction worker if it is not running and jobs remain.
# - Publishes newly auto-verified edges to Supabase (idempotent upserts).
# Silent (empty stdout) when nothing changed — watchdog pattern.
set -uo pipefail
cd "$(dirname "$0")/.."

OUT=""
PENDING=$(npx tsx src/graph/queue.ts status 2>/dev/null | awk '/pending/{print $4}')
PENDING=${PENDING:-0}

# --- Self-heal workers (N parallel on one resident model — no engine swaps) --
WORKER_TARGET=4
RUNNING=$(pgrep -f "queue.ts run worker-" | wc -l | tr -d ' ')
if [[ "$PENDING" -gt 0 && "$RUNNING" -lt "$WORKER_TARGET" ]]; then
  for i in $(seq "$RUNNING" $((WORKER_TARGET - 1))); do
    LOCAL_LLM_MODEL=qwen3.8-flash-next nohup npx tsx src/graph/queue.ts run "worker-$i" >> out/full-drain.log 2>&1 & disown || true
    OUT+="worker-$i restarted (pid $!), pending=$PENDING\n"
  done
fi

# --- Publish verified edges --------------------------------------------------
pnpm corpus:review -- audit >/dev/null 2>&1 || { echo "audit failed"; exit 0; }
pnpm corpus:review -- export >/dev/null 2>&1 || { echo "export failed"; exit 0; }

SQL_FILE="out/verified_edges.sql"
[[ -s "$SQL_FILE" ]] || exit 0   # nothing verified yet — silent

# Count publishable pairs from the export header comment (SQL is one jsonb array line).
NEW_COUNT=$(grep -o 'publishable direct-input pairs: [0-9]*' "$SQL_FILE" | grep -o '[0-9]*$')
[[ -n "$NEW_COUNT" ]] || exit 0   # malformed/empty export — silent, retry next tick
MARKER="out/.last_published_count"
LAST=$(cat "$MARKER" 2>/dev/null || echo 0)

if [[ "$NEW_COUNT" != "$LAST" ]]; then
  if supabase db query --linked -f "$SQL_FILE" >/dev/null 2>&1; then
    echo "$NEW_COUNT" > "$MARKER"
    printf "select count(*)::text from corpus_derivation_edge where review_status='verified';\n" > /tmp/derivation_counts.sql
    LIVE=$(supabase db query --linked -f /tmp/derivation_counts.sql 2>/dev/null | python3 -c "import sys,json,re; t=sys.stdin.read(); m=re.search(r'\{.*\}',t,re.S); r=json.loads(m.group(0)) if m else {}; row=(r.get('rows') or [{}])[0]; print(next(iter(row.values()), '?'))" 2>/dev/null || echo "?")
    OUT+="published: export=$NEW_COUNT pairs, live verified=$LIVE, queue pending=$PENDING\n"
  else
    OUT+="import FAILED (will retry next tick); export=$NEW_COUNT\n"
  fi
fi

printf '%b' "$OUT"
