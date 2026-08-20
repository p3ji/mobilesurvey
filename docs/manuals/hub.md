# Hub — Survey Management Console

The **hub** is the central entry point for the Modular Survey Tools suite. It's a dashboard for
managing surveys, viewing respondent data, and accessing authoring and analysis tools.

> Open it at <https://p3ji.github.io/mobilesurvey/> (production) or
> `pnpm --filter @mobilesurvey/hub dev` (local, → <http://localhost:5175>).

The hub home screen displays a grid of modules, most of them live, a few still on the roadmap:

## Live modules

### 📋 Collector — Manage surveys & monitor collection

Create, publish, and track survey responses.

**Key features:**

- **Create a survey** — click "+ New survey", name it, and open it in the Designer for authoring.
- **Survey list** — all surveys grouped into two sections:
  - **Live surveys** — published and open to respondents (no access code required). Copy the
    respondent link and share it, or embed it in an email.
  - **Designer demos** — draft or code-gated surveys. Use to explore the designer without collecting
    real data.
- **Survey settings:**
  - **Require access code** — toggle to gate responses by access code (e.g. a CATI call list) or
    leave open for anonymous respondents.
  - **Published** — toggle to publish/draft a survey. Only published surveys appear in respondent links.
- **Response dashboard** — click a survey's **▼ Responses** to see:
  - List of all responses with submit timestamps and completion status.
  - Response counts trending over time (chart).
  - Redacted CSV export (PII variables excluded per the instrument definition).
- **Edit in Designer** — click any survey to open it in the Designer for edits. Changes to a
  published survey take effect immediately for new and resuming respondents.

**Demo mode:** If you're offline or the backend is unreachable, Collector shows two bundled demo
surveys (Household & Employment Survey, Feature Demo) in read-only mode. Switch back when online.

---

### 🔍 Searcher — Search and reuse survey metadata

Find and reuse questions, variables, and code lists — either across your own surveys, or against a
real external corpus of Statistics Canada variables.

**Two scopes**, selected by tab at the top of Searcher (each is a separate search — results aren't
merged, since usage counts and citations mean different things in each):

- **Your surveys** — searches the surveys in this hub.
  - **Type filter** narrows results to **Instruments**, **Questions**, **Variables**, or **Code
    Lists** (reusable category schemes, e.g. industry codes, marital status).
  - Each hit shows its label, type, source survey, usage count (how many other surveys reference
    it), a code-list preview where applicable, and matching terms highlighted.
  - Leave the search box empty to browse all entries of the selected type.
  - Click any hit to open the source survey in the Designer for inspection or reuse.
- **Statistics Canada** — searches ~195,000 real variable occurrences extracted from ~580 StatCan
  RDC survey documentation dictionaries (1982–2025), loaded under the Statistics Canada Open
  Licence.
  - A **subject facet rail** (StatCan's own 31-subject taxonomy) filters results; suggested
    (unconfirmed) subject tags are marked with a dot.
  - Misspelled queries get an automatic **did-you-mean** correction (a 15k-word corpus vocabulary,
    e.g. `opiod` → `opioid`), with the original query offered back.
  - Every record cites its source survey, cycle, and variable, and an **"Open source"** link opens
    the original dictionary PDF at the exact cited page.
  - A **Concepts** sub-view groups variables into a DDI-style concept cascade (Concept →
    Conceptual Variable → Represented Variable) and shows a timeline of which survey cycles
    changed a variable's wording or coding.

**Use case:** When authoring a new survey, search your own past surveys for similar questions to
maintain consistency, or search the Statistics Canada corpus to align a new variable's wording and
coding with an established StatCan standard.

---

### 📄 Migrator — Turn an existing questionnaire into a live survey

Paste or upload a plain-text, Word, or PDF questionnaire — including Statistics Canada
electronic-questionnaire exports — and get back a working instrument.

- Extracts questions, infers response types (numeric, choice, text, date, etc.), and converts
  routing/skip-logic hints into instrument branches.
- Shows a preview table of extracted questions before you commit.
- Unsupported constructs are flagged with a warning rather than guessed at.
- Opens the result directly in the Designer for review and cleanup.

---

### 🎓 Training Hub — Videos and guides

Video overviews and walkthroughs for learning the suite, from first survey to collection
management.

---

### 📱 Designer — Pro Mode, Easy Mode, and Business Collection

Entry points to the survey authoring tool. (See [authoring-tool.md](authoring-tool.md) for the
full manual.)

- **Designer — Pro** — full-featured instrument authoring with tree editing, variables, routing,
  and flowchart view. Best for complex surveys.
- **Designer — Easy Mode** — simple question-by-question editor. Best for quick surveys and
  questionnaire testing.
- **Designer — Business Collection** — a form-first designer for establishment surveys: numeric
  data tables with live totals, paste-from-Excel entry, and balance edits across sections, modeled
  on Statistics Canada's Federal Science Expenditures and Personnel (FSEP) questionnaire.

All three open a blank instrument (or load a survey if you click "Edit in Designer" on a Collector
survey). Your edits are saved back to the hub when you click **Save**.

Try a demo survey first: scroll to "Try a demo survey" on the hub home, select a template, and
click "Open in Pro Mode" or "Open in Easy Mode" to explore the designer's interface.

---

### 📊 Analyzer — Descriptive statistics and response overview

Explore collected response data: completion funnels, frequency distributions, and field-level
charts built from live responses. Export responses or paradata as CSV.

---

### ✅ Validator — Flag, confront, and correct collected data

Post-collection data editing over a survey's responses, run after collection to catch errors
before analysis:

- **Metadata-derived checks** — range, type, and skip-logic consistency inferred straight from the
  instrument definition.
- **Re-run of collection-time edits** — the same soft/hard edits the respondent saw, re-evaluated
  against the stored data.
- **Robust statistical outliers** — values flagged against the response distribution, not fixed
  thresholds.
- **Cross-source confrontation** — upload a reference dataset and define mappings to flag
  mismatches against an external source of truth.
- **Analyst-authored rules** — write additional checks as expressions, promotable from a flag you
  triaged.
- Optional **LLM-assisted** review (requires `VITE_ANTHROPIC_API_KEY` — see
  [DEPLOYMENT.md](../../DEPLOYMENT.md) security notes before enabling in a real deployment).

All checks feed one scored, prioritized **flag queue** where you disposition (accept/correct/
suppress) each flag; accepted corrections and suppressions are remembered so they don't resurface
on the next run unless the underlying value changes.

---

### 📍 Sensor Data Collection — Consent-gated GPS and camera questions

Location and photo question types for the respondent app, each gated by its own respondent
consent toggle before the question is shown:

- **Geolocation** — captures coordinates at an author-configured precision, with a manual
  fallback for respondents who decline device location.
- **Photo** — captures a photo, strips EXIF metadata client-side before upload, and optionally
  runs ML-assisted coding (e.g. identifying food items for a nutrition study) that the respondent
  always reviews and confirms before it's saved.

Try the last page of the Feature Demo Survey (`?survey=demo` in the respondent app) to see both in
action. Authoring these questions is covered in
[authoring-tool.md](authoring-tool.md).

---

## Upcoming modules

### 🎧 Interviewer Mode & Supervisor Dashboard

CATI (computer-assisted telephone interviewing) workflows: a case queue with call-back scheduling
for interviewers, and a dashboard for supervisors to monitor completion/outcome rates and
reassign cases. On-premises / local-API only (not part of the Supabase-backed hosted demo).

### 🧪 Questionnaire Tester

Walks every path through a web survey automatically, catching dead ends, routing errors, and gaps
between the designed instrument and the rendered form. The underlying engine
(`packages/questionnaire-bot`) has path enumeration, a Playwright driver, and HTML reports working
against a static fixture and a CLI; a hub tile and a run against a live `apps/runtime` server are
still on the roadmap.

---

## Quick start

1. **Open the hub** at <https://p3ji.github.io/mobilesurvey/>.
2. **Try a demo** — scroll down to "Try a demo survey", select "Feature Demo Survey", click
   "Open in Pro Mode" to explore the Designer.
3. **Create a survey** — in the Collector module, click "+ New survey", name it, click "✎ Edit in
   Designer".
4. **Build the survey** — add questions, routing logic, and validation in the Designer. Use the
   Preview pane to test as you go.
5. **Publish** — back in Collector, toggle the "Published" switch to publish your survey.
6. **Share the link** — copy the respondent link and share it with respondents (via email, QR code,
   SMS, etc.).
7. **Monitor responses** — watch responses come in via the Collector dashboard. Click "▼ Responses"
   to see details and download a CSV.

---

## Offline and demo mode

If the backend (Supabase) is unreachable:

- The hub shows **"Demo mode"** in the connection indicator.
- Collector displays bundled demo surveys (read-only); new surveys cannot be created.
- Survey data (responses, sessions) are not persisted to the server.
- The Designer and Searcher continue to work with bundled demo content.

To return to full mode, ensure the backend is online and refresh the page.

---

## Access and permissions

The hub is **public and un-authenticated** in this demo. All surveys are visible to all users. For
production deployments, implement:

- **Authentication** — user login (email, SAML, etc.).
- **Role-based access control (RBAC)** — survey owner, editor, viewer roles.
- **Data privacy** — encryption of responses in transit and at rest, automatic PII redaction, audit
  logging.

---

## Help and support

- **Authoring tool help** — click **? Help** in the Designer to open the authoring manual.
- **This manual** — you're reading it!
- **Project documentation** — see the [docs index](../) for architecture, API, and deployment guides.
