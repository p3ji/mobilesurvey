#!/usr/bin/env bash
# Publish auto-verified derivation edges from the local queue to Supabase.
# Idempotent: reviewer audit re-verifies candidates in place; export rewrites
# out/verified_edges.sql; import upserts on deterministic edge_id/dedupe_key.
# Safe to run repeatedly while the extraction worker is still draining — each
# pass publishes whatever has been verified since the last pass.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Reviewer audit (auto-verify candidates)"
pnpm corpus:review -- audit

echo "==> Export publishable SQL"
pnpm corpus:review -- export

SQL_FILE="out/verified_edges.sql"
if [[ ! -s "$SQL_FILE" ]]; then
  echo "No verified edges to publish ($SQL_FILE empty). Done."
  exit 0
fi

echo "==> Import into Supabase (linked project)"
supabase db query --linked -f "$SQL_FILE" >/dev/null
echo "Published. Live counts:"
cat > /tmp/derivation_counts.sql <<'EOF'
select 'total_edges' as k, count(*)::text as v from corpus_derivation_edge
union all select 'verified', count(*)::text from corpus_derivation_edge where review_status='verified';
EOF
supabase db query --linked -f /tmp/derivation_counts.sql
