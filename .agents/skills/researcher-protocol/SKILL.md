---
name: researcher-protocol
description: Use when building, operating, reviewing, or publishing the mobilesurvey Researcher catalogue of outside publications that analyze Statistics Canada data. Covers source discovery, evidence claims, rights, and public use counts; use metadata-corpus for Searcher and the official StatCan metadata corpus.
---

# Researcher protocol

Researcher links **works issued outside Statistics Canada** to the survey data they demonstrably analyze. Read `AGENTS.md` for current state, `docs/researcher-plan.md` for the evolving source and product plan, and `tools/research/researcher/README.md` for current commands. Use `tools/research/researcher/HERMES_RUN_PROMPT.md` when preparing a Hermes handoff. These files, not this skill, own changing provider details, counts, cadences, and storage choices.

## Establish identity and provenance

- Keep the work's **issuing organization** separate from every catalogue or API that discovered it. Exclude Statistics Canada-issued works even when an outside index lists them. Retain external works found in several sources as one work with multiple source memberships.
- Normalize DOI and canonical URL before deduplication; preserve original provider IDs, URLs, retrieval dates, and source wording. Treat title/author/year similarity as a review lead rather than proof of identity. Do not merge preprints and final versions without evidence of their relationship.
- Preserve the raw survey wording and a canonical program. Use the existing Canadian grounding and foreign-agency disqualification checks in `tools/research/researcher/src/model.ts` and `src/deterministic.ts`; short acronyms alone are weak evidence.

## Classify only supported data use

- A dataset citation, CRDCN “Data Used” tag, Scholix link, or DataCite `IsCitedBy`/`IsReferencedBy` assertion is a **lead**. It does not prove the work analyzed that survey or identify a cycle.
- Record an `analyzed` claim only when the work's own data, methods, results, or other specific passage supports it. Keep comparison and background mentions separate and out of analyzed-use counts. Retain the exact source URL, section/page, and internally checked evidence span for each claim.
- Use `exact_cycles` only for cycles explicitly supported by the cited passage. Preserve a stated range as a range; otherwise use `program_only`. Never derive a cycle from publication year, a catalogue coverage label, or neighboring survey cycles. Do not treat a named construct as a released variable code without literal code and survey/cycle support.
- Themes describe the **work**, not the survey's Searcher subject tag. Preserve unresolved or conflicting claims for review rather than filling gaps by inference. Review a work's issuing organization, use role, cycle precision, and theme independently.

## Respect access and publication rights

- Check a provider's documented API or site access rules before repeated retrieval. Use permitted feeds/exports or bounded page checks where no API exists; unclear bulk rights call for manual intake or a provider export. Pace requests, honor provider limits and backoff, and record access/rights decisions per source.
- API access to an abstract or full text is not republication permission. Keep restricted text local to permitted extraction/review; do not put full PDFs, restricted abstracts, or third-party evidence quotes in the public snapshot, browser bundle, or vector payload. Public records may show reviewed facts, links, and evidence locations.

## Expand sources without losing review control

- For recurring acquisition, follow `docs/researcher-plan.md` §Source expansion and monitoring: register the source and access path, use bounded query windows and resumable checkpoints, advance a watermark only after a complete window, compare response hashes, and reprocess changed evidence. Keep source runs, errors, and last-success times observable. A missing search hit alone is not evidence that a reviewed work disappeared.
- A new adapter starts with a small, judged sample and repeat-run check. Measure **unique reviewed works** and coverage gaps by survey/cycle/theme/sector/year, along with duplicates, false positives, rights exceptions, API failures, and reviewer backlog. Source expansion, extraction, review, and public publication are separate stages. Do not treat a proposed crawl cadence as an active schedule or permission to publish.
- Preserve approved claims and provenance when a source changes. Material contradictions, withdrawals, or rights changes open a review item; suppress restricted text promptly. Publish only facts that pass the current evidence and review gate.

## Report and verify

- Label metrics as observed publications and documented **use/outputs**, not outcomes, impact, or a census of all StatCan data use. Count one distinct work once overall, once per reviewed analyzed survey relationship, and only under exact cycle members the work actually identifies. Show unresolved-cycle and source-coverage context beside counts.
- After pipeline or public-output changes, run the relevant Researcher tests/typecheck and inspect a sample of exported records and links. Report the input window/source, new versus duplicate works, approved/rejected/unresolved claims, rights issues, retries, and any change in the public catalogue. Keep Searcher's official metadata and Researcher's outside-publication store separate, with stable survey/cycle/theme keys for a future join.
