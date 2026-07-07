# Hub — Survey Management Console

The **hub** is the central entry point for the Modular Survey Tools suite. It's a dashboard for
managing surveys, viewing respondent data, and accessing authoring and analysis tools.

> Open it at <https://p3ji.github.io/mobilesurvey/> (production) or
> `pnpm --filter @mobilesurvey/hub dev` (local, → <http://localhost:5175>).

The hub home screen displays six modules. Four are live; two are coming soon:

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

Find and reuse questions, variables, and code lists across all surveys in the hub.

**Key features:**

- **Search box** — type a keyword (e.g. "employment", "age", "Canada") to find matching components.
- **Type filter** — narrow results by component type:
  - **Instruments** — whole surveys
  - **Questions** — individual survey items
  - **Variables** — named data slots
  - **Code Lists** — reusable category schemes (e.g. industry codes, marital status)
- **Search results** — each hit shows:
  - The component's label and type.
  - Which survey it came from (if applicable).
  - Usage count (how many other surveys reference this component).
  - A code-list preview (if it's a category scheme).
  - Matching terms highlighted.
- **Browse mode** — leave the search box empty to browse all entries of a selected type.
- **Open in Designer** — click any hit to open the source survey in the Designer for inspection
  or reuse.

**Use case:** When authoring a new survey, search for similar questions from past surveys (e.g.
"employment status") and copy them into your new instrument to maintain consistency and save
authoring time.

---

### 📱 Designer — Pro Mode, Easy Mode, and Business Collection (coming soon)

Entry points to the survey authoring tool. (See [authoring-tool.md](authoring-tool.md) for the
full manual.)

- **Designer — Pro** — full-featured instrument authoring with tree editing, variables, routing,
  and flowchart view. Best for complex surveys.
- **Designer — Easy Mode** — simple question-by-question editor. Best for quick surveys and
  questionnaire testing.
- **Designer — Business Collection** (coming soon) — optimized for business data collection and
  establishment surveys.

All three open a blank instrument (or load a survey if you click "Edit in Designer" on a Collector
survey). Your edits are saved back to the hub when you click **Save**.

Try a demo survey first: scroll to "Try a demo survey" on the hub home, select a template, and
click "Open in Pro Mode" or "Open in Easy Mode" to explore the designer's interface.

---

### 📊 Analyzer — Descriptive statistics and response overview

(Coming in Phase 13.) Explore collected response data with charts, frequency tables, and
descriptive stats.

---

## Upcoming modules

### 🏢 Designer — Business Collection

Optimized for business and establishment surveys. Includes structured inputs, validation rules, and
integration with business registers. (Currently in testing.)

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
