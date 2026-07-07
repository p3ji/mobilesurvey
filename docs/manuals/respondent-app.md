# Respondent App — User Manual

The respondent app is the **Electronic Questionnaire (EQ)** — the survey as a respondent
experiences it. It loads a questionnaire built in the [authoring tool](authoring-tool.md), lets a
respondent answer it page by page, saves progress automatically, and submits the responses.

You typically reach it via the [hub](hub.md) (click "Collector" → select a survey and launch it) or
access it directly via:
- Local dev: `pnpm --filter @mobilesurvey/runtime dev` (→ <http://localhost:5174>)
- Production: respondent links from the hub are of the form `https://p3ji.github.io/mobilesurvey/respondent/?survey=<id>`

This manual is written for two audiences: **respondents** (how to fill it in) and **survey
operators** (how access codes, resume, and paradata behavior work).

## Contents
1. [Signing in with an access code](#signing-in-with-an-access-code)
2. [Answering the survey](#answering-the-survey)
3. [Saving and resuming](#saving-and-resuming)
4. [Submitting](#submitting)
5. [For survey operators](#for-survey-operators)

---

## Signing in with an access code

When you open the app you see the **access-code screen**.

1. Enter the access code from your invitation letter.
2. Click **Begin survey**.

The code identifies your case and loads any information already on file (for example, your name),
so the survey can greet you and skip questions that don't apply.

> **Demo codes:** `ABC123` (Jordan Lee) and `DEF456` (Marie Tremblay). An unrecognized code shows
> an error so you can re-check and try again.

---

## Answering the survey

Once you're in, the survey runs **one page at a time**:

- A **progress bar** and **"Page N of M"** show how far along you are. The total can change as you
  answer — some pages only appear based on earlier answers.
- **Question types** include number entry, text boxes, single-choice and multiple-choice lists,
  yes/no, dates, and "mark all that apply" checkboxes.
- **Required questions** are marked with a red asterisk (**\***).
- **Helpful instructions** appear under some questions.
- **Language** — switch between available languages (e.g. **EN / FR**) at the top right at any time;
  your answers are kept.

### Moving between pages

- **← Back** returns to the previous page (your answers are preserved).
- **Next →** advances to the next page.

If a page has a problem that must be fixed (a required answer is missing, or an answer breaks a
rule), you'll see:

- a red message under the affected question, and
- **"Fix errors to continue"** with the **Next** button disabled.

Correct the highlighted items and **Next** re-enables. Some checks are **warnings** only — they
explain a concern (e.g. an unusually high value) but still let you continue.

---

## Saving and resuming

Your progress is **saved automatically** after every change — a brief **"✓ Saved"** appears in the
header. You don't need to do anything to save.

If you close the tab, lose your connection, or come back later:

1. Re-open the app.
2. Enter the **same access code**.
3. You'll be returned to **where you left off**, with your previous answers intact. The page is
   marked **"Resumed."**

Your saved progress is cleared once you successfully submit.

---

## Submitting

On the last page, the **Next** button becomes **Submit ✓**. Clicking it:

- records your responses to the survey's backend (Supabase for production surveys), and
- shows a **confirmation screen** with:
  - a **✓ Survey submitted** message,
  - **Response data** — your answers in structured (data-schema) form, with a **⎘ Copy JSON**
    button,
  - a **Paradata trail** — the log of what happened during the session (see below),
  - **↺ Start a new session** to return to the access-code or home screen.

> **Demo surveys** use local mock storage and do not persist responses to the server (your data is
> kept in the browser only). Real surveys deployed from the hub persist responses to the Collector
> dashboard for review and analysis.

---

## For survey operators

This section explains the operational behaviour behind the respondent experience.

### Access codes (CMS) and anonymous launch

Surveys are launched in two ways:

1. **Access code (code-gated surveys):** The respondent enters a code that is validated against a
   Collection Management System (CMS). The code resolves to a **case** and its **pre-fill data**
   (e.g. respondent name, contact details, region), which populate the instrument before the survey
   starts. Demo codes `ABC123` and `DEF456` are built-in examples.

2. **Anonymous (open surveys):** No access code is required. The respondent starts immediately with
   a stable browser-based ID (stored in `localStorage`) that allows resume even without a code.

Both flows support pre-fill (if pre-fill mappings are defined in the instrument) and save/resume.

### Resume / session persistence

After every answer change, the app saves the current **responses plus page position** to the session
store, keyed by the respondent ID (either from the code or the anonymous ID). Returning with the
same code/ID restores that saved state. On submit, the session is cleared.

- **Demo surveys:** Use browser `localStorage` (local-only; survives browser close but not device loss).
- **Production surveys:** Use Supabase (cloud-backed; survives everything, encrypted in transit/at rest).

### Paradata (audit trail)

The app emits a **paradata trail** — a timestamped log of respondent behaviour:

| Event | When |
| --- | --- |
| `session_start` / `session_resume` | A new session begins / a saved session is resumed |
| `page_next` / `page_back` | The respondent navigates between pages |
| `answer` | An answer is entered or changed |
| `page_complete` | The final page is finished |
| `submit` | The survey is submitted |

For **production surveys**, paradata is streamed to Supabase (`paradata` table) for monitoring
response quality, drop-off rates, and timing. The completion screen displays a summary of the trail.
For **demo surveys**, the trail is shown locally only.

### Accessibility (WCAG 2.1 AA, RTL)

The respondent app supports:

- **WCAG 2.1 AA** — screen readers (NVDA, JAWS, VoiceOver), keyboard-only navigation, high-contrast
  mode, focus indicators.
- **RTL (right-to-left) surveys** — Arabic, Hebrew, and other RTL languages render with correct
  text directionality and logical-property CSS.
- **Multi-language surveys** — language toggle at the top right; respondent answers are preserved
  when switching languages.

### Which questionnaire is served?

When launched from the hub (via a respondent link), the app loads the instrument specified in the
URL (`?survey=<id>`). The `id` can be:

- A **bundled demo** (e.g. `lfs` for Household & Employment Survey, `demo` for Feature Demo)
- A **user-created survey** persisted in the hub's database

Instruments are authored in the [authoring tool](authoring-tool.md) and published via the hub's
Collector module.
