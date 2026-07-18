# ddigraph interop harness

Proves the acceptance criterion of docs/ddi-compliance-plan.md §3.5: **ddigraph** — the
target org's own DDI→graph tool (https://github.com/pbisson44/ddigraph) — must ingest our
FragmentInstance exports and build the correct knowledge graph. XSD validity (the CI gate in
`packages/ddi-xml`) is only a proxy; this is the real thing, run on demand, not in CI.

## Run

```bash
# 1. Write FragmentInstance exports of demo+fsep and a model-derived expected-count manifest
pnpm ddi:interop:fixtures            # → scripts/ddigraph-interop/out/

# 2. One-time Python setup (Python 3.10+)
cd scripts/ddigraph-interop
python -m venv .venv
.venv/Scripts/python -m pip install ddigraph        # (.venv/bin/python on POSIX)

# 3. Ingest with ddigraph's unmodified fragment loader and assert
.venv/Scripts/python check_interop.py
```

## What is asserted

1. **Entity counts** by element type equal a manifest computed from the instrument *model*
   (not from the XML), so the check is independent of the emission logic.
2. **Node keys are canonical URNs** under our agency — ddigraph uses the verbatim URN as its
   graph node key, so these strings become the org's Neo4j keys verbatim.
3. **Structural edges**: Instrument→Sequence, every QuestionConstruct→its QuestionItem,
   coded QuestionItems→CodeList, every CodeList→its Categories. ddigraph drops edges whose
   target fragment is missing, so these also detect dangling references.

## Last verified result (2026-07-17, ddigraph 0.4.2)

```
demo: 121 nodes, 212 edges, 5 coded questions -> CodeList; OK
fsep: 131 nodes, 221 edges, 0 coded questions -> CodeList; OK
All interop checks passed.
```

`out/` and `.venv/` are generated and gitignored.
