# Enterprise Adoption Plan — Closing the Design→Render Standards Gap

> Response to a prospective agency client. This is the **next phase of development** (Phases 7–11),
> ordered by the client's own statement of business impact. It is written to be *audited*, not
> demoed: every claim below is mapped to code that exists today, and every gap is named plainly.
> The client's core fear is "looked good in a demo, fell apart in production." This plan is
> structured to retire that fear with proof, not promises.

_Last updated 2026-06-28._

---

## 1. Honest current-state assessment

A capability is **Have** (in production, tested), **Partial** (exists but unproven / dev-only /
known-broken), or **Gap** (not built). Nothing is overstated; the client will audit this.

| # | Client concern | Status | What exists today | What's missing |
|---|---|---|---|---|
| 1 | Stable API for integration | **Partial** | `runtime-engine` defines 4 integration interfaces — `CMS`, `SessionStore`, `ParadataSink`, `SampleProvider` — with a Hono reference implementation (`apps/api`). | Prod path is browser→Supabase REST; the API is a dev-only fallback. No published, versioned, documented contract. |
| 1 | Import existing DDI instruments | **Gap** | Object model is DDI-Lifecycle-3.3 *aligned* (concepts, universes, category schemes, variables, control constructs). Import is JSON (our schema) + a plain-text Migrator. | **No DDI-XML ingest.** The client's repository is almost certainly DDI-Lifecycle/Codebook XML, which we cannot read. *This is the keystone gap.* |
| 1 | Responses → data warehouse | **Partial** | Responses persist to Supabase (SQL-queryable); paradata CSV export in the hub. | No warehouse connector/stream; **paradata insert is broken in prod** (anon `INSERT` blocked by RLS — open bug). |
| 2 | 200+ q, complex routing, expressions | **Partial** | Schema + engine support it: `loop` (nested rosters), `grid`, `ifThenElse`, `markAll`, hard/soft `edits`, derived `computation`. | No large-instrument fixture, no perf budget. Designer "searchable/collapsible tree for 100+ q" is explicitly *not done*. |
| 2 | 10k concurrent respondents | **Gap** | Respondent app is a static SPA; reads scale via CDN. | No load test, no published perf profile, write/RLS path unverified at scale. |
| 2 | Paradata (completion time, interactions) | **Partial** | Append-only `paradata` table; `durationMs`, typed events; dashboard with KPIs + per-respondent event timeline. | Broken in prod (see above). Event taxonomy not yet documented as a contract. |
| 3 | WCAG 2.1 AA certified | **Gap** | `:focus-visible` styling, some ARIA (`aria-pressed` language toggle, `role="group"`, `aria-live` gate). | No audit, no `axe-core` in CI, no VPAT. **Not certified.** |
| 3 | Bilingual EN/FR, programmatic | **Have** | Every human-visible string is an `InternationalString` (BCP-47 keyed) at the metadata layer; runtime language toggle switches instantly without losing state. | — |
| 3 | RTL + special character sets | **Gap** | UTF-8 throughout (CJK/accents fine). | No `dir`-aware rendering, no CSS logical properties, no bidi handling. |
| 4 | Expression engine validation story | **Partial** | Tree-walking evaluator with **no `eval`/`Function`**, a whitelisted function table, and a prototype-pollution guard (own-property check). Unit-tested. | No formal spec doc, no property/fuzz tests, no methodology-team sign-off artifact. |
| 4 | Methodology audit of evaluator | **Supported, not done** | Evaluator is ~160 lines, side-effect-free, deterministic — designed to be audited. | The audit itself hasn't been run with the client's methodologists. |
| 4 | Standard question libraries / code lists | **Partial** | `categorySchemes` + a TF-IDF `metadata-registry` for cross-survey question/codelist reuse. | Not linked to the client's standard libraries. |
| 5 | PII handling | **Gap** | "Public-by-design" demo posture; security rests on Supabase RLS. | No field-level PII classification, no retention policy, no encryption story beyond provider defaults. |
| 5 | Audit trail for versions/changes | **Gap** | Respondent *behaviour* is an append-only audit trail (paradata). | Questionnaire versions **overwrite** (`surveys.updated_at`); no change history/diff/approver trail. |
| 5 | On-prem vs SaaS | **Partial (latent)** | `apps/api` (Hono + `node:sqlite`) is a self-hostable backend implementing every interface. | Not packaged/documented for on-prem; prod is SaaS (GitHub Pages + Supabase). |
| 5 | SOC 2 / PIPEDA | **Gap** | — | No assessment, no controls program. |
| 6 | Interviewer Mode (CATI/field) | **In progress** | Further than our public notes: schema has `InterviewerConfig`, `moduleKind` (entry/main/exit), `interviewerOnly`, free navigation; a designer entry/exit module builder is committed. | Hub still labels it "coming soon"; not GA. |
| 6 | Offline for remote field work | **Gap** | — | No service worker / IndexedDB / sync queue. Critical for the client's 40% CATI/field volume. |
| 7 | Long-term support / sustainability | **Gap** | Open source, clean monorepo, documented architecture. | Bus-factor 1; no governance model, SLA, or maintenance commitment. |
| 8 | Migrate 50+ DDI instruments | **Gap** | Same blocker as #1 (no DDI-XML import). | — |
| 8 | Parallel run for 6 months | **Feasible, not built** | DDI alignment makes interop possible. | No parallel-run/sync config. |
| 8 | Training 30 designers + SMEs | **Partial** | Easy Mode + Migrator lower the burden; Training Hub exists (1 intro video). | Curriculum, worked examples, role-based guides not built. |

**The one-line summary for the client:** the *standards-canonical core they care about is real* — one DDI-aligned
schema drives design, render, and runtime, which structurally eliminates the JSON-drift bug class they
described. The maturity gaps are **interoperability with their DDI-XML repository, proof at scale,
accessibility certification, version/security controls, and a credible support commitment.** This plan
closes them in priority order.

---

## 2. Guiding principles for this phase

1. **Proof over features.** The client adopts *mature* software. Every phase ends in an artifact they
   can audit (a passing load test, a VPAT, a signed methodology review), not a new toggle.
2. **DDI-XML interoperability is the keystone.** It unblocks integration (#1), migration (#8), and the
   "10 real instruments, nothing breaks" proof. It is sequenced first.
3. **No new known-broken paths.** We fix the open paradata-RLS bug before we extend collection, so the
   paradata dashboard the client wants reflects real data.
4. **Honesty as a feature.** Section 6 lists what we will *not* claim. We'd rather under-promise the
   audit than repeat the last 15 years of survey-tool demos.

---

## 3. The roadmap (ordered by the client's stated business impact)

### Phase 7 — Interoperability & Proof Foundation  *(keystone; unblocks #1, #8, and the POC)*

- **DDI-XML round-trip** — a new `packages/ddi-xml` codec:
  - Import: DDI-Lifecycle 3.2/3.3 **and** DDI-Codebook 2.5 → our `Instrument` JSON.
  - Export: `Instrument` → DDI-Lifecycle 3.3 XML (closes the loop; their repo stays canonical).
  - A **fidelity report** per import: what mapped cleanly, what was approximated, what was dropped —
    so "nothing breaks" is a measured claim, not a hope.
- **Fix paradata in prod** — add the anon-`INSERT` RLS policy so completion time + field interactions
  actually flow (currently the dashboard is structurally ready but starved of data).
- **Publish the integration contract** — promote the 4 existing `runtime-engine` interfaces to a
  **versioned OpenAPI spec**; document the paradata event taxonomy; provide a warehouse export
  (SQL view + signed CSV now, webhook stream next).
- **POC scaffolding** — a harness that ingests the client's 10 sample DDI instruments and emits a
  per-instrument render + fidelity diff.

### Phase 8 — Scale & Methodology Assurance  *(#2, #4)*

- **Large-instrument fixture** (200+ questions, 15–20 routing conditions, nested rosters) committed as
  a test asset; a **performance budget** (parse/flatten/first-paint) enforced in CI.
- **Designer searchable/collapsible tree** for 100+ question instruments (the deferred Phase 6 item).
- **Load profile** — a k6 harness modelling 10k concurrent respondents against the prod write path;
  published numbers with the bottleneck analysis (CDN reads vs. Supabase writes vs. RLS).
- **Expression engine assurance package**: a formal grammar/semantics spec, a **property-based + fuzz**
  test suite, and a methodology-team **audit checklist** producing a sign-off artifact. ("Who designed
  it" → documented; "can we audit it" → yes, here's the kit.)
- **Promote `questionnaire-bot` to "Validator"** — it already enumerates routing paths and generates
  answers; surface a per-survey **coverage report** (every reachable path exercised; dead-ends, typos,
  and design↔render drift flagged) and run it in CI.

### Phase 9 — Accessibility & Internationalization  *(#3)*

- **WCAG 2.1 AA**: `axe-core` gate in CI, manual NVDA/VoiceOver/keyboard audit of the respondent app,
  remediation, and a published **VPAT**.
- **RTL & bidi**: `dir`-aware rendering, migrate layout to CSS logical properties, Arabic/Hebrew
  fixture survey in the test suite. (EN/FR already works programmatically — this generalizes it.)

### Phase 10 — Security, Compliance & Deployment  *(#5, #7)*

- **Questionnaire version history**: immutable versioned instruments with a change/approver audit trail
  and visual diff (answers the "methodology changes getting lost in translation" pain directly).
- **PII controls**: field-level sensitivity classification in the schema, retention/erasure policy,
  encryption posture documented; harden RLS off the public-by-design demo default.
- **On-prem package**: Docker Compose of `apps/api` (Hono) + Postgres — a fully self-hosted deployment
  with zero external dependencies, plus a parallel-run configuration.
- **Sustainability & compliance program**: a governance/contributor model that retires bus-factor-1, a
  published maintenance commitment, and a **SOC 2 / PIPEDA gap assessment** with a remediation roadmap.

### Phase 11 — Interviewer Mode GA + Offline  *(#6 — the client's 40%)*

- Promote CATI/field interviewer mode from preview to **GA**: entry (phone/address validation) and exit
  (household phone enumeration for coverage weighting) modules, free navigation.
- **Offline-first runtime**: service worker + IndexedDB response/paradata queue with a sync-and-conflict
  layer, so interviewers work with no signal and reconcile on reconnect.

---

## 4. The proof-of-concept sprint  *(the client's "what would move us forward")*

A time-boxed sprint on **one mid-complexity survey (50–80 questions, 15–20 routing conditions, 3
sections)**, demonstrating the full loop **and** the interop story:

1. **Import** 10 real DDI-XML instruments from their repository → fidelity report (Phase 7 codec).
2. **Design** the chosen survey in the Designer (or import + refine); render it identically in the
   respondent runtime (one schema, no transform step — the standards gap is *absent by construction*).
3. **Validate** with the `questionnaire-bot` coverage report: every routing path exercised, drift flagged.
4. **Collect** live responses end-to-end with **working paradata** (completion time, field interactions).
5. **Dashboard** the results in the Collector view (KPIs, distributions, per-respondent event timeline,
   CSV/warehouse export).

Accompanied by: a **technical architecture review** with their IT + methodology leads, and **roadmap
access** scoped to Interviewer Mode (Phase 11), Analytics (Phase 8), and the accessibility audit
timeline (Phase 9).

---

## 5. Sequencing rationale

```
Phase 7 (interop + proof) ─┬─> POC sprint  ──> architecture review
                           │
Phase 8 (scale + methodology) ─> Phase 9 (a11y/i18n) ─> Phase 10 (security/compliance) ─> Phase 11 (interviewer GA + offline)
```

Phase 7 is first because it unblocks the two highest-impact questions (integration, migration) *and* the
client's gating proof. Phases 8–10 harden the maturity dimensions an enterprise buyer checks before
signing. Phase 11 lands the interviewer capability that is 40% of their volume — sequenced last only
because offline sync should be built on a hardened, audited core, not ahead of it.

---

## 6. What we will *not* claim (the honest conversation)

- We are **not** WCAG-certified today. We will be after Phase 9, with a VPAT — not before.
- We have **not** run 10k concurrent. We will publish real numbers in Phase 8 — including the bottleneck
  if we find one.
- We do **not** read DDI-XML yet. The keystone of this plan is building exactly that, with a fidelity
  report so "nothing breaks" is measured per instrument.
- We are **not** SOC 2 compliant and have a **bus-factor-1** risk today. Phase 10 puts a governance and
  compliance program in front of that — and if the answer to "what if the maintainer moves on" isn't
  credible to the client, we'd rather surface it now than after adoption.

The skepticism is earned by 15 years of tools that demoed well and broke in production. This plan is
deliberately built around the inverse: prove the boring, load-bearing things first.
