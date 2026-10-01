#!/usr/bin/env bash
# Fast-lane extraction worker: same queue (atomic leases make multi-worker safe),
# different local LLM — a small MoE for high-throughput bulk extraction.
# Quality is gated downstream by the reviewer's verbatim grounding check, so a
# smaller extractor model is acceptable; provenance per edge records this model.
cd "$(dirname "$0")/.."
echo $$ > out/fast-lane.pid
export LOCAL_LLM_MODEL="qwen3.6-35b-a3b-ud-q4_k_m_gguf"
exec npx tsx src/graph/queue.ts run >> out/fast-lane.log 2>&1
