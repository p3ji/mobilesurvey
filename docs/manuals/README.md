# mobilesurvey — User Manuals

End-user guides for the Modular Survey Tools suite. These are *how-to* manuals (what you can do
and how); for the architecture and design rationale see the [docs index](../) instead.

## The suite

| Tool | Who uses it | Manual |
| --- | --- | --- |
| **Hub** | Survey managers, collectors, researchers | [hub.md](hub.md) |
| **Authoring tool** (Designer) | Survey methodologists / questionnaire designers | [authoring-tool.md](authoring-tool.md) |
| **Respondent app** (runtime EQ) | Survey respondents | [respondent-app.md](respondent-app.md) |
| **Expression language** | Designers writing routing, edits, and derived values | [expression-language.md](expression-language.md) |

## How the tools fit together

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            Hub (home screen)                             │
│  ┌──────────────────┬──────────────────┬──────────────────────────────┐  │
│  │   Collector      │    Searcher      │   Authoring Tools            │  │
│  │  (manage        │  (find & reuse   │  • Designer — Pro            │  │
│  │   surveys,      │   questions,     │  • Designer — Easy Mode      │  │
│  │   publish,      │   variables,     │  • Designer — Business       │  │
│  │   monitor)      │   code lists)    │                              │  │
│  └──────────────────┴──────────────────┴──────────────────────────────┘  │
│                                   ↕                                       │
└──────────────────────────────────────────────────────────────────────────┘
         Create/edit/publish      (via Designer)        Respondents take
         surveys and track          ↓                   survey via link
         responses               instrument JSON           ↓
                                  ↓                    Respondent App
                            ┌─────────────┐           (page-by-page,
                            │ Respondent  │ ←→ ←→     save/resume)
                            │ App (EQ)    │
                            └─────────────┘
```

1. **Hub** is your starting point — manage surveys, explore metadata, and access authoring tools.
2. Use a **Designer** (Pro, Easy, or Business mode) to build an instrument — the complete
   questionnaire definition: pages, questions, response types, routing logic, validation rules,
   variables, and translations.
3. **Publish** the instrument via the Collector to make it available to respondents.
4. Respondents access the survey via a **Respondent App** link: they enter an optional access
   code, answer page-by-page, and submit.
5. **Monitor** responses in the Collector dashboard: view response data, download CSV, track
   collection progress.

The same instrument drives the Designer's live **Preview** and the standalone Respondent App, so
what you see while authoring is exactly what respondents get.

## Quick start

```bash
pnpm install

# Start the hub (entry point)
pnpm --filter @mobilesurvey/hub dev       # hub               → http://localhost:5175

# Or start individual tools:
pnpm --filter @mobilesurvey/designer dev  # authoring tool    → http://localhost:5173
pnpm --filter @mobilesurvey/runtime dev   # respondent app    → http://localhost:5174
```

The hub is also deployed at <https://p3ji.github.io/mobilesurvey/> (production entry point).
All modules are accessible from the hub home screen, or launch them individually via the
`localhost` URLs above.

## Key concepts (one-minute glossary)

- **Instrument** — the whole questionnaire definition (DDI-compliant JSON).
- **Construct** — any node in the questionnaire tree: a page, section, question, roster, branch,
  statement, or computation.
- **Variable** — a named slot the data is stored in. Three kinds: *collected* (answered by the
  respondent), *hidden* (pre-filled / administrative), *derived* (auto-computed from a formula).
- **Response domain** — the answer type for a question. Common types: numeric, text, boolean, code
  (single/multiple choice), datetime, file, lookup, markAll (DDI-compliant multi-response), table
  (establishment/business data grids).
- **Category scheme** — a reusable code list (e.g. a list of industries, marital statuses) used by
  choice questions, markAll, and lookup questions.
- **Edit** — a validation rule: *hard* edits block progress, *soft* edits warn but allow continue.
- **Routing / visibility** — `visible when` conditions and branches that show or hide constructs
  based on prior answers.
- **Piping** — inserting a previous answer into later text with `${variableName}`.
- **Roster** — a repeating block (a loop), e.g. one set of questions per household member.
- **Page** — a screen the respondent sees; the respondent app advances one page at a time.
- **Interviewer module kind** — designates a page/section as entry (pre-interview validation),
  main (core survey), or exit (post-interview housekeeping) for CATI workflows. Hidden from
  self-administered respondents.
- **Paradata** — timestamped audit trail of respondent behaviour (session start, page navigation,
  answers, submission).
