#!/usr/bin/env bash
# Publish auto-verified derivation edges from the local queue to Supabase.
# Idempotent: export rewrites out/verified_chunks/chunk_*.sql; import upserts on
# deterministic (target_record_id, upper(btrim(source_var_name))).
set -euo pipefail
PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../../.." && pwd)"
cd "$PKG_DIR"

echo "==> Export publishable SQL chunks"
npx tsx src/graph/reviewer.ts export

CHUNK_DIR="$PKG_DIR/out/verified_chunks"
if [[ ! -d "$CHUNK_DIR" ]]; then
  echo "No verified chunks directory found ($CHUNK_DIR). Done."
  exit 0
fi

CHUNKS=("$CHUNK_DIR"/chunk_*.sql)
TOTAL="${#CHUNKS[@]}"
echo "==> Importing $TOTAL chunk(s) into Supabase (linked project)..."
IDX=0
for f in $(ls -v "$CHUNK_DIR"/chunk_*.sql); do
  IDX=$((IDX + 1))
  echo "  [$IDX/$TOTAL] $(basename "$f")"
  (cd "$REPO_ROOT" && supabase db query --linked -f "$f" >/dev/null)
done

echo "Published. Live counts:"
cat > /tmp/derivation_counts.sql <<'EOF'
select 'total_edges' as k, count(*)::text as v from corpus_derivation_edge
union all select 'verified', count(*)::text from corpus_derivation_edge where review_status='verified'
union all select 'programs_with_verified', count(distinct survey_group)::text from corpus_derivation_edge where review_status='verified';
EOF
(cd "$REPO_ROOT" && supabase db query --linked -f /tmp/derivation_counts.sql)
