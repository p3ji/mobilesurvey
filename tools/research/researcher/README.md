# Researcher local extraction pilot

This package stages published works for human review. Its SQLite database is local staging, not the public catalogue. Only approved `analyzed` claims appear in the export. No public Researcher UI or hosted database is connected yet.

## Input

Prepare a UTF-8 JSONL file, one object per source passage. Keep source text within the access and reuse terms of that source. This is a synthetic example, **not a real publication**:

```json
{"title":"Pilot article","doi":"10.1234/example","url":"https://example.org/article","source":"pilot","sourceId":"pilot-1","year":2022,"abstractRights":"unknown","passage":"We analyzed the Canadian Internet Use Survey (CIUS) 2022 data.","passageLocation":"Methods, p. 3","surveyCandidates":[{"program":"CIUS","aliases":["Canadian Internet Use Survey","CIUS"]}]}
```

For long documents, submit relevant methods or data sections as `passage`. A passage is split into 2,400-character chunks with 250-character overlap. Another source row with the same DOI joins the same work and adds source membership. DOI is the strongest identity key; without DOI, normalized URL is used. Avoid inferring cycle from CRDCN Data Used labels or publication year. Retain full PDFs outside the database.

## Commands

From the repository root, after `pnpm install`:

```sh
pnpm --filter @mobilesurvey/researcher researcher seed path/to/sources.jsonl
LOCAL_LLM_URL=http://127.0.0.1:1234/v1 LOCAL_LLM_MODEL=qwen3.8-27b pnpm --filter @mobilesurvey/researcher researcher run 25
pnpm --filter @mobilesurvey/researcher researcher status
pnpm --filter @mobilesurvey/researcher researcher review 50
pnpm --filter @mobilesurvey/researcher researcher approve CLAIM_ID
pnpm --filter @mobilesurvey/researcher researcher reject CLAIM_ID
pnpm --filter @mobilesurvey/researcher researcher export tools/research/researcher/out/reviewed.jsonl
```

`RESEARCHER_DB` overrides the default ignored `out/researcher.db`. Jobs have stable IDs from work identity, passage hash, extraction stage, prompt version, model, and chunk. Re-seeding is safe. A single worker leases one chunk at a time; failed jobs retry up to three times. The model endpoint must be loopback. Every claim remains pending for human review; quote, alias, cycle, and variable checks can block approval. Export is a local reviewed JSONL for a future durable catalogue import, not a deployment command.

Current source intake is a supplied JSONL. Automated CRDCN/OpenAlex/Crossref adapters, rights audit, gold set, and D1/Worker pilot remain separate follow-on gates in `docs/researcher-plan.md`.
