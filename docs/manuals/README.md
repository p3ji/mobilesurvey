# mobilesurvey — User Manuals

End-user guides for the mobilesurvey suite. These are *how-to* manuals (what you can do and how);
for the architecture and design rationale see the [docs index](../) instead.

## The suite

| Tool | Who uses it | Manual |
| --- | --- | --- |
| **Authoring tool** (designer) | Survey methodologists / questionnaire designers | [authoring-tool.md](authoring-tool.md) |
| **Respondent app** (runtime EQ) | Survey respondents | [respondent-app.md](respondent-app.md) |
| **Expression language** | Designers writing routing, edits, and derived values | [expression-language.md](expression-language.md) |

## How the tools fit together

```
                 ┌──────────────────────────┐
   designer  →   │  instrument (validated    │   →  respondent app
 (authoring)     │  JSON: questions, logic,  │      (runtime EQ)
                 │  variables, edits)        │
                 └──────────────────────────┘
        you build it here            respondents answer it here
```

1. A **designer** builds an *instrument* — the complete questionnaire definition: pages,
   questions, response types, skip logic, validation rules, variables, and translations.
2. The instrument is exported as a single validated JSON file.
3. The **respondent app** loads an instrument and runs it: respondents enter an access code,
   answer page-by-page, and submit.

The same instrument drives the designer's live **Preview** and the standalone respondent app, so
what you see while authoring is what respondents get.

## Quick start

```bash
pnpm install
pnpm --filter @mobilesurvey/designer dev   # authoring tool → http://localhost:5173
pnpm --filter @mobilesurvey/runtime  dev   # respondent EQ  → http://localhost:5174
```

The authoring tool is also deployed at <https://p3ji.github.io/mobilesurvey/>.

## Key concepts (one-minute glossary)

- **Instrument** — the whole questionnaire definition.
- **Construct** — any node in the questionnaire tree: a page, section, question, roster, branch,
  statement, or computation.
- **Variable** — a named slot the data is stored in. Three kinds: *collected* (answered by the
  respondent), *hidden* (pre-filled / administrative), *derived* (auto-computed from a formula).
- **Response domain** — the answer type for a question (number, text, single/multiple choice, …).
- **Category scheme** — a reusable code list (e.g. a list of industries) used by choice questions.
- **Edit** — a validation rule: *hard* edits block progress, *soft* edits warn but allow continue.
- **Routing / visibility** — `visible when` conditions and branches that show or hide constructs.
- **Piping** — inserting a previous answer into later text with `${variableName}`.
- **Roster** — a repeating block (a loop), e.g. one set of questions per household member.
- **Page** — a screen the respondent sees; the respondent app advances one page at a time.
