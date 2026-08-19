# StatCan corpus — parse report

Committed artifact of `pnpm --filter @mobilesurvey/statcan-corpus corpus:parse`
(docs/metadata-repo-plan.md, M2). Byte-identical for the same archive and options, so a diff
here is always a real change in parse coverage rather than run-to-run noise (D9). Wall-clock
and machine details go to the gitignored `out/parse-stats.json` for exactly that reason.

Source archive: `CRSB_ADHOC_CENTRAL_002_FromStatCan_DeStatCan20260818133553.zip`

## Documents

| | |
|---|---:|
| Files in the delivery | 3,006 |
| Dictionary candidates | 1,810 |
| Of those, PDFs (the only format M2 reads) | 1,368 |
| Parsed | 1,368 |
| Produced at least one variable | 1,157 (84.6%) |
| Produced nothing | 211 (15.4%) |

### Layouts detected

The document-type code does *not* determine the layout — that assumption was tested and it
failed — so the parser detects layout from content. This table is what the corpus actually
contains.

| Layout | Documents | Share |
|---|---:|---:|
| `labelled` | 1,078 | 78.8% |
| `collection` | 58 | 4.2% |
| `field` | 22 | 1.6% |

### Documents that produced no records

Itemized rather than silently dropped (D7). Every document counted here is named
individually in `out/parse-notes.jsonl`.

| Reason | Documents |
|---|---:|
| no recognized layout | 210 |
| layout found, no variable read | 1 |

## Records

| | |
|---|---:|
| Variable occurrences | 436,962 |
| Mean per productive document | 377.7 |
| Response-category entries | 840,096 |
| `corpus.jsonl` | 283.3 MB |
| Mean bytes per record | 680 |

### Field completion

The share of occurrences carrying a non-empty value. A low rate is not automatically a parser
failure: the dominant layout prints a fixed template, so `Question Text:` appears on nearly
every entry and is legitimately empty for derived and administrative variables that were never
asked of a respondent. `name` is omitted because it is a record’s identity and is 100% by
construction.

| Field | Populated | Share |
|---|---:|---:|
| `position` | 431,548 | 98.8% |
| `length` | 432,921 | 99.1% |
| `concept` | 384,943 | 88.1% |
| `questionText` | 249,969 | 57.2% |
| `universe` | 357,365 | 81.8% |
| `note` | 189,249 | 43.3% |
| `codes` | 170,963 | 39.1% |
| `collectionName` | 7,000 | 1.6% |

### By language

Split out because a recall gap concentrated in one language averages away in the total —
which is how the French category-row shortfall stayed invisible until it was measured this
way.

| Language | Documents | Occurrences | With a code list | Share coded |
|---|---:|---:|---:|---:|
| `en` | 644 | 228,252 | 97,872 | 42.9% |
| `fr` | 585 | 195,499 | 72,874 | 37.3% |
| `unknown` | 139 | 13,211 | 217 | 1.6% |

## Fidelity

| | |
|---|---:|
| Notes | 939 |
| Of those, warnings | 211 |

Per-file detail is in the gitignored `out/parse-notes.jsonl`, one JSON object per note.

