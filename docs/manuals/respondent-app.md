# Respondent App — User Manual

The respondent app is the **Electronic Questionnaire (EQ)** — the survey as a respondent
experiences it. It loads a questionnaire built in the [authoring tool](authoring-tool.md), lets a
respondent answer it page by page, saves progress automatically, and submits the responses.

> Open it with `pnpm --filter @mobilesurvey/runtime dev` (→ <http://localhost:5174>).

This manual is written for two audiences: **respondents** (how to fill it in) and **survey
operators** (how the access-code, resume, and paradata behaviour works).

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

- records your responses for the session, and
- shows a **confirmation screen** with:
  - a **✓ Survey submitted** message,
  - **Response data** — your answers in structured (data-schema) form, with a **⎘ Copy JSON**
    button,
  - a **Paradata trail** — the log of what happened during the session (see below),
  - **↺ Start a new session** to return to the access-code screen.

> In this demo, responses are collected **in the browser session only** — they are **not sent to or
> stored on any server**. The confirmation screen simply shows what *would* be transmitted.

---

## For survey operators

This section explains the operational behaviour behind the respondent experience. In this iteration
these are backed by **mock** implementations; a real deployment swaps them for live services
without changing the questionnaire or the UI.

### Access codes (CMS)
The code is exchanged for a **case** and its **pre-fill data** via a Collection Management System
(CMS) client. The mock recognises `ABC123` → case-0001 and `DEF456` → case-0002, each with a name
and region that pre-fill the instrument. A real CMS validates single/multi-use codes server-side
and returns the case's sample data.

### Resume / session persistence
After every change, the app saves the current **responses plus the page position** to a session
store, keyed by the case. Re-entering the same code restores that state. On submit the session is
cleared. The demo store uses the browser's `localStorage` with light obfuscation — **production must
use real encryption** (e.g. WebCrypto AES-GCM keyed by the session token).

### Paradata
The app emits a **paradata trail** — an audit log of respondent behaviour — including:

| Event | When |
| --- | --- |
| `session_start` / `session_resume` | A new session begins / a saved session is resumed |
| `page_next` / `page_back` | The respondent navigates between pages |
| `answer` | An answer is entered or changed |
| `page_complete` | The final page is finished |
| `submit` | The survey is submitted |

The completion screen displays the buffered trail. A real deployment would stream these to a
paradata sink for monitoring response quality, drop-off, and timing.

### Status round-trip
The app reports case status back to the CMS — `started`, `resumed`, and `completed` — so collection
progress can be tracked centrally.

### Which questionnaire is served?
In this prototype the app runs the bundled "Household & Employment Survey" instrument. In a full
deployment the case/CMS determines which instrument to serve, and instruments are produced by the
[authoring tool](authoring-tool.md).
