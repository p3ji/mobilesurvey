#!/usr/bin/env bash
set -euo pipefail

# mobilesurvey Researcher: Autonomous Nightly Enrichment Pipeline
# Runs unattended at 01:00 AM local time / 06:00 UTC

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${PROJECT_ROOT}/tools/research/researcher/out/nightly_runs"
mkdir -p "${LOG_DIR}"
TODAY=$(date "+%Y-%m-%d")
LOG_FILE="${LOG_DIR}/${TODAY}_stdout.log"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting mobilesurvey Researcher nightly enrichment..." | tee -a "${LOG_FILE}"

cd "${PROJECT_ROOT}"

# Ensure PATH has pnpm and node
export PATH="/usr/local/bin:/opt/homebrew/bin:${PATH}"

# Execute nightly pipeline with deployment enabled
pnpm --filter @mobilesurvey/researcher enrich:nightly --deploy 2>&1 | tee -a "${LOG_FILE}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Nightly enrichment completed successfully." | tee -a "${LOG_FILE}"
