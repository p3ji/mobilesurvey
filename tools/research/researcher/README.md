# Researcher local extraction pipeline

This package stages outside publications that use Statistics Canada data for human review. Its SQLite database is local staging, not the public catalogue. Only approved `analyzed` claims appear in the export. The Hub currently shows a three-work static snapshot generated from reviewed claims; no hosted Researcher database is connected yet. See the [pilot report](../../../docs/researcher-pilot-2026-10-01.md).

## Input

Prepare a UTF-8 JSONL file, one object per source passage. Keep source text within the access and reuse terms of that source. This is a synthetic example, **not a real publication**:

```json
{"title":"Pilot article","doi":"10.1234/example","url":"https://example.org/article","source":"pilot","sourceId":"pilot-1","year":2022,"abstractRights":"unknown","passage":"We analyzed the Canadian Internet Use Survey (CIUS) 2022 data.","passageLocation":"Methods, p. 3","surveyCandidates":[{"program":"CIUS","aliases":["Canadian Internet Use Survey","CIUS"]}]}
```

For long documents, submit relevant methods or data sections as `passage`. A passage is split into 2,400-character chunks with 250-character overlap. Another source row with the same DOI joins the same work and adds source membership. DOI is the strongest identity key; without DOI, normalized URL is used. Avoid inferring cycle from CRDCN Data Used labels or publication year. Retain full PDFs outside the database.

Use `issuingOrganization` to record the publisher or issuing body separately from `source`, the catalogue or service where the work was found. Statistics Canada-issued works are outside Researcher's public scope even when indexed by an external source. The preview excludes works with that issuing body or a `statcan.gc.ca` publication URL; acquisition and review should check origin explicitly before seeding.

## Commands

From the repository root, after `pnpm install`:

```sh
pnpm --filter @mobilesurvey/researcher researcher seed out/sources.jsonl
LOCAL_LLM_URL=http://127.0.0.1:1234/v1 LOCAL_LLM_MODEL=qwen3.8-27b pnpm --filter @mobilesurvey/researcher researcher run 25
pnpm --filter @mobilesurvey/researcher researcher status
pnpm --filter @mobilesurvey/researcher researcher audit
pnpm --filter @mobilesurvey/researcher researcher review 50
pnpm --filter @mobilesurvey/researcher researcher approve CLAIM_ID
pnpm --filter @mobilesurvey/researcher researcher reject CLAIM_ID
pnpm --filter @mobilesurvey/researcher researcher export out/reviewed.jsonl
pnpm --filter @mobilesurvey/researcher researcher preview ../../../platform/hub/src/researcherPilot.json
```

`pnpm --filter` runs commands in this package directory, so relative input and output paths are package-relative. `RESEARCHER_DB` overrides the default ignored `out/researcher.db`. Jobs have stable IDs from work identity, passage hash, extraction stage, prompt version, model, and chunk. Re-seeding is safe. A single worker leases one chunk at a time; transient failures retry up to three times with backoff. Configuration failures stop immediately; after correcting one, `researcher reset-failed` resets failed jobs for an explicit rerun. The model endpoint must be loopback. The tested LM Studio server requires `json_schema` response format; `qwen3.8-27b` needed a 6,000-token output budget to finish the mention-only case. Every claim remains pending for human review; quote, alias, cycle, and variable checks can block approval. `audit` refreshes evidence issues for completed jobs and scopes them per claim. `export` writes a local reviewed JSONL for a future durable catalogue import. `preview` writes a rights-safe static snapshot of approved facts for the Hub; it omits evidence quotes and abstracts.

Current source intake is a supplied JSONL. Automated CRDCN/OpenAlex/Crossref adapters, rights audit, gold set, and D1/Worker pilot remain separate follow-on gates in `docs/researcher-plan.md`.
