> **Reference only — not actively maintained.** For current state see `AGENTS.md` (phase status, bugs) and `H:\My Drive\Brain2\Projects\mobilesurvey.md` (requirements, decisions).

# Phase 1 — DDI-Compliant Instrument Schema

The instrument specification is the contract between every layer. It lives in
`packages/instrument-schema`:

- `src/types.ts` — TypeScript types (source of truth).
- `src/zod.ts` — Zod mirror used for runtime validation.
- `src/validate.ts` — shape validation + referential-integrity checks.
- `src/jsonSchema.ts` — derives a JSON Schema artifact via `zod-to-json-schema`.
- `src/examples/household.instrument.ts` — a bilingual example exercising every feature.

## Top-level shape

```ts
Instrument {
  id; version; ddiProfile: 'ddi-lifecycle-3.3';
  languages: LanguageCode[]; defaultLanguage;
  metadata: { title: InternationalString; agency; description?; created? };
  concepts: Concept[];
  universes: Universe[];
  categorySchemes: CategoryScheme[];   // reusable code lists
  variables: Variable[];               // collected | hidden | derived
  prefillMappings: PrefillMapping[];   // sample field → variable
  sequence: SequenceConstruct;         // root of the ControlConstruct tree
}
```

## DDI mapping

| Schema element | DDI-Lifecycle object | Notes |
| --- | --- | --- |
| `InternationalString` | *InternationalString* | `Record<lang, string>` — every visible string is multilingual at the metadata layer. |
| `Concept` | *Concept* | The idea a question/variable measures. |
| `Universe` | *Universe* | Population in scope; optional membership `clause` (expression). |
| `CategoryScheme` / `Category` | *CategoryScheme* / *Category* + *Code* | Reusable code lists backing coded domains. |
| `Variable` | *Variable* / *RepresentedVariable* | `kind`: `collected` \| `hidden` \| `derived`. `derived` carries a `compute` expression. |
| `ResponseDomain` | *ResponseDomain* family | `code` → *CodeDomain*, `numeric` → *NumericDomain*, `text` → *TextDomain*, `datetime` → *DateTimeDomain*, plus `boolean`, `file`, and `lookup` (advanced search). |
| `QuestionConstruct` | *QuestionConstruct* → *QuestionItem* | References a variable; text supports `${…}` piping. |
| `SequenceConstruct` | *Sequence* | Ordered group / section. |
| `IfThenElseConstruct` | *IfThenElse* | Branching / skip patterns. |
| `LoopConstruct` | *Loop* | **Roster**. Nest a `loop` inside a `loop` for **nested rosters**. |
| `ComputationConstruct` | *ComputationItem* | Assigns a derived value mid-interview. |
| `StatementConstruct` | *StatementItem* | Display-only text/instruction. |
| `EditRule` | *Instruction* / validation | `type: hard` (blocks) \| `soft` (warns + override). `when` fires when **true**. |
| `PrefillMapping` | sample→variable binding | Drives piping and downstream routing from pre-fills. |

## Validation (`validateInstrument`)

Two layers:

1. **Shape** — Zod. Discriminated unions over construct `type` and response-domain `type`;
   recursion handled with a single `z.lazy` reference (`controlConstructSchema`). Construct
   option schemas are kept as plain `ZodObject`s so the discriminated union can read the `type`
   discriminator.
2. **References** — `checkReferences` walks the tree and reports issues Zod cannot express:
   - questions referencing an undeclared variable,
   - coded/lookup domains pointing at an unknown category scheme,
   - loops with neither `countVariableRef` nor `loopWhile`,
   - duplicate variable names, derived variables missing `compute`,
   - pre-fill mappings targeting unknown variables.

Returns a discriminated result: `{ ok: true; instrument }` or `{ ok: false; issues }` where each
issue has a `path` and `message`. The designer's **JSON Spec** panel surfaces these inline.

## Feature coverage in the example

`household.instrument.ts` (EN/FR) demonstrates: a **nested roster** (household members → each
member's employers), `hidden` + `derived` variables, a mid-interview `computation`, a **hard**
edit (household size range) and **soft** edits (implausible age / income), **piping**
(`Hello ${respondentName}`, `Age of ${memberName}`), and **pre-fill** mappings
(`contact_name → respondentName`, `region_code → region`).