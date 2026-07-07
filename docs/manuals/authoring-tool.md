# Authoring Tool — User Manual

The authoring tool (the **designer**) is where you build a questionnaire from scratch: structure,
questions, answer types, routing logic, validation, variables, and translations. Everything you build
is a single validated *instrument*, previewed live and exported as JSON.

The designer is part of the **Modular Survey Tools** suite. You reach it from the hub's home screen
(click "Designer — Pro" or "Designer — Easy Mode") or open it directly via:
- Local dev: `pnpm --filter @mobilesurvey/designer dev` (→ <http://localhost:5173>)
- Hosted: <https://p3ji.github.io/mobilesurvey/> → select a Designer module

The tool opens on a blank instrument (or loads an existing survey if opened from the hub with
`?survey=<id>`). You can always return to the hub by clicking the **Modular Survey Tools** link
at the top left.

## Contents
1. [The screen at a glance](#the-screen-at-a-glance)
2. [The toolbar](#the-toolbar)
3. [Building structure (the tree)](#building-structure-the-tree)
4. [Editing an element (the Inspector)](#editing-an-element-the-inspector)
5. [Question response types](#question-response-types)
6. [Validation edits](#validation-edits)
7. [Routing, visibility & branches](#routing-visibility--branches)
8. [Rosters (repeating blocks)](#rosters-repeating-blocks)
9. [Variables & pre-fill](#variables--pre-fill)
10. [Bilingual editing & piping](#bilingual-editing--piping)
11. [The Preview pane](#the-preview-pane)
12. [The JSON Spec panel](#the-json-spec-panel)
13. [Render mode](#render-mode)
14. [Worked examples](#worked-examples)
15. [Tips & gotchas](#tips--gotchas)

---

## The screen at a glance

The window has a top **toolbar** and three columns:

| Column | Tabs | What it does |
| --- | --- | --- |
| **Left** | **Structure** / **Variables** | The questionnaire tree, and the variable catalogue |
| **Centre** | *(Inspector)* | Edits whatever you selected on the left |
| **Right** | **Preview** / **JSON Spec** | Live mobile preview, and the validated JSON |

The basic loop is: **select something on the left → edit it in the centre → watch the right update.**

---

## The toolbar

- **Modular Survey Tools** (left, clickable link) — return to the hub home screen.
- **Title** — the instrument's title, in the current language.
- **Language pills (EN / FR …)** — switch the editing/preview language. All label fields and the
  preview follow this toggle. (Add or remove languages by editing the instrument; the default
  template is bilingual EN/FR.)
- **↶ Undo / ↷ Redo** — step backward/forward through your edits.
- **Pro Mode / Easy Mode ▾** — switch between two authoring interfaces:
  - **Pro Mode:** Three-column layout (Structure tree, Inspector, Preview/JSON). Full control over
    all constructs and properties.
  - **Easy Mode:** Question-by-question card interface. Simpler for linear surveys; focuses on
    questions and routing. (Pages and advanced constructs like rosters are only editable in Pro Mode.)
- **💾 Save** — if the instrument was opened from the hub (via `?survey=<id>`), this button saves
  your edits back to the hub's database. (Unsaved changes are persistent in your browser session.)
- **Export ▾** — export the instrument in multiple formats:
  - **⬇ HTML Questionnaire** — a static HTML preview, suitable for printing or sharing.
  - **⬇ Instrument JSON** — the raw JSON file; import this into another designer instance.
  - **⬇ JSON Schema** — the instrument's JSON Schema (for validation elsewhere).
  - **🖨 PDF Spec** — a formal specification (pages, questions, edit rules, variable dictionary).
- **? Help** — open this manual in a new tab.
- **▶ Render** — launch the full respondent experience in this window (see
  [Render mode](#render-mode)).

---

## Building structure (the tree)

The **Structure** tab shows the questionnaire as a tree. Hover (or select) a node to reveal its
action buttons:

| Button | Action |
| --- | --- |
| **⊕** | Add a new element. On a container it reads **"Add into:"**; on a leaf it reads **"Add after:"** |
| **↑ / ↓** | Move the element up/down among its siblings |
| **✕** | Delete the element (and its children) |

Click a node's label to **select** it for editing in the Inspector. The root node can only be
added into (no move/delete).

### Element types you can add

| Icon | Type | Use it for |
| --- | --- | --- |
| `□` | **Page** | A screen break — respondents see one page at a time. Only addable inside a sequence. |
| `?` | **Question** | A thing you ask the respondent. |
| `▣` | **Section** | A labelled group of constructs (no page break). |
| `↻` | **Roster** | A repeating block (loop), e.g. one block per household member. |
| `⎇` | **Branch** | An *if/then/else* — show one set of children or another based on a condition. |
| `"` | **Statement** | Display-only text (intros, instructions, thank-you). |
| `ƒ` | **Computation** | Calculate a value mid-interview and store it in a variable. |

> **Pages vs. sections.** Both are "sequences" underneath. A **page** has its *Is a page* flag on,
> which inserts a screen break — the preview and respondent app paginate at every page. A
> **section** just groups and labels constructs on the current page.

---

## Editing an element (the Inspector)

Select any element to edit it in the centre panel. The fields depend on the element type. Common
ones:

- **Bilingual text fields** show one input per language (EN, FR). Fill each.
- **"Visible when"** — a condition controlling whether the element appears (see
  [Routing](#routing-visibility--branches)). Leave blank = always visible.

### Question

| Field | Meaning |
| --- | --- |
| **Collects variable** | Which variable stores the answer. Pick from the catalogue. |
| **Question text** | What the respondent reads (bilingual; supports `${piping}`). |
| **Instruction** | Optional helper text shown under the question. |
| **Required** | If on, the respondent must answer before continuing (a hard edit). |
| **Response domain** | The answer type — see the [next section](#question-response-types). |
| **Validation edits** | Custom hard/soft rules — see [Validation edits](#validation-edits). |
| **Visible when** | Show the question only when this condition is true. |

### Section / Page

- **Is a page** checkbox — turns the sequence into a page break.
- **Page title / Section label** — bilingual heading.
- **Visible when** — hide the whole page/section (and everything in it) conditionally. This is how
  you build "show this page only to employed respondents."

### Statement

- **Statement text** (bilingual, multiline) + **Visible when**.

### Branch (if/then/else)

- **Branch condition** — when true, the **then** children render; otherwise the **else** children.
  Add children into each branch from the tree.

### Computation

- **Target variable** — where the result is stored.
- **Expression** — the formula (see [expression-language.md](expression-language.md)). Runs at the
  point it sits in the flow.

### Roster

See [Rosters](#rosters-repeating-blocks).

### Section / Page — Interviewer module kind

For **CATI (interviewer-assisted) surveys**, you can designate a page/section as:

- **standard section/page** (default) — part of the main survey flow.
- **Entry — pre-interview validation** — runs *before* the main survey. Typically: confirm the
  respondent's phone number, address, or sample data. Hidden in self-administered mode.
- **Main — core survey content** — the standard setting.
- **Exit — post-interview housekeeping** — runs *after* the main survey completes. Typically:
  household roster or follow-up scheduling. Hidden in self-administered mode.

Only one entry and one exit section are supported per instrument. The **Interviewer Mode** panel
(in the toolbar's mode dropdown, Pro Mode only) lets you preview and configure these sections.

---

## Question response types

Set a question's **Response domain → Type**. Options:

| Type | Renders as | Extra settings |
| --- | --- | --- |
| **numeric** | Number input | Min, Max, Decimals |
| **text** | Text box | Multiline (on/off), max length (JSON) |
| **boolean** | Yes / No radios | — |
| **code** | Single- or multi-choice from a code list | Category scheme, Selection (single/multiple) |
| **datetime** | Date / time / datetime picker | Mode (date \| time \| datetime) |
| **file** | File chooser | Accepted types (JSON) |
| **lookup** | Search-as-you-type from a code list | Category scheme |
| **markAll** | "Mark all that apply" checkboxes | Category scheme, Variable prefix |
| **table** | Spreadsheet-like grid of numeric cells | Row/column count, unit caption, min/max/decimals per cell, disabled cells, computed totals |

### markAll (DDI-compliant "mark all that apply")

A `markAll` question stores **each option as its own dichotomous variable** named
`prefix_CODE` (e.g. with prefix `Q01` and a list of A/B/C you get `Q01_A`, `Q01_B`, `Q01_C`). Each
stores a code:

`1` = yes (checked) · `2` = no · `6` = valid skip · `7` = don't know · `9` = not stated/missing.

The Inspector shows the generated variable names live as you set the prefix and scheme.

> **code (multiple) vs. markAll.** Use *code → multiple* when you want one variable holding an
> array of selected codes. Use *markAll* when downstream processing needs a separate yes/no
> variable per option (the DDI-compliant form for multi-response items).

---

## Validation edits

On a question, open **Validation edits → + Add edit**. Each edit has:

- **Severity** — **hard** (blocks the respondent from continuing) or **soft** (shows a warning but
  lets them proceed).
- **Fires when (true = violation)** — a condition that, when **true**, triggers the message. For
  example `$age > 99` fires when the age is over 99.
- **Message** — the bilingual text shown when it fires.

The **Required** checkbox is a built-in hard edit, so you don't need to write one for "must answer."

Edits evaluate live: the Preview shows a running count of hard/soft edits, and the respondent app
blocks the **Next** button while any hard edit on the current page is unsatisfied.

---

## Routing, visibility & branches

Three mechanisms control what a respondent sees, all powered by the same
[expression language](expression-language.md):

1. **Visible when** (on questions, sections, pages, rosters, statements) — show the element only
   when the condition is true. A page with `visible when` = `$lfStatus == "emp"` only appears for
   employed respondents.
2. **Branch (if/then/else)** — route to one of two sets of children.
3. **Required / edits** — gate progression rather than visibility.

The **"Visible when"** box gives **live feedback**: a red border + message if the expression
doesn't parse, and a list of the variables it references when it does. You can reference any
variable with `$name` and use the [functions and operators](expression-language.md) available.

---

## Rosters (repeating blocks)

A **Roster** repeats its children once per item — e.g. one set of questions per household member,
and (nested) one block per employer within each member.

| Field | Meaning |
| --- | --- |
| **Roster label** | Heading for the whole block. |
| **Loop index variable** | A short name (e.g. `m`) available *inside* the roster as `$m` — the 1-based iteration number. Use it in piping/headings. |
| **Count variable (iterations)** | A numeric variable whose value sets how many times to repeat (e.g. `hhSize`). |
| **…or loop while** | Instead of a fixed count, repeat while a condition holds. |
| **Per-item heading** | Heading shown above each iteration, e.g. `Member ${m}`. |
| **Visible when** | Show the roster conditionally. |

**Nested rosters:** add a roster *into* another roster. Inner questions can read outer answers —
e.g. an employer question inside the members roster can pipe the member's name with
`${memberName}`. Iteration counts are capped in preview to keep things responsive.

---

## Variables & pre-fill

Open the **Variables** tab (left panel).

### Variables

Each variable has a coloured badge for its **kind**:

| Badge | Kind | Meaning |
| --- | --- | --- |
| **C** | collected | Answered by the respondent (linked from a question's *Collects variable*). |
| **H** | hidden | Administrative / pre-filled; never shown to the respondent. |
| **D** | derived | Auto-computed from a **Compute** formula whenever its inputs change. |

Other fields: **Name** (the identifier used in expressions and piping), **Representation** (code /
numeric / text / datetime / boolean / file), **Label** (bilingual), **Category scheme** (for code
variables), and **Compute** (for derived variables).

> A question's answer is only stored if its **Collects variable** points at a real variable. Create
> the variable here first, then link it from the question.

### Pre-fill mappings

Pre-fill maps incoming **sample / CMS fields** (e.g. `contact_name`, `region_code`) onto your
variables, so they're populated before the respondent starts. Add a mapping, pick the sample field
and the target variable. Pre-filled values are then available for piping (e.g. greeting the
respondent by name) and logic.

---

## Bilingual editing & piping

- **Bilingual editing** — every label/text/message has one input per declared language. Switch the
  toolbar language to preview each. Keep translations in sync as you author.
- **Piping** — insert a previously captured value into later text with `${variableName}`. Example:

  > `Hello ${respondentName}, this survey asks about your household.`

  Pipeable sources include collected answers, hidden/pre-filled values, derived values, and roster
  index variables (`${m}`). Piping works in question text, statements, headings, and per-item
  labels.

---

## The Preview pane

The **Preview** tab renders the instrument in a mobile frame, live, using a mock respondent
profile. It updates instantly as you edit.

- **≡ NQ button** — opens the **question index**: every question with its variable name, text, and
  page number. Click any entry to jump straight to it (it navigates pages as needed).
- **Page navigation** — **← Prev / Page N / M / Next →** when the instrument has pages.
- **Edit counter** — shows the number of *hard* and *soft* edits currently firing (or "✓ No edits").
- **↺ Reset** — clears the preview's answers back to the pre-filled starting state.
- **Language** — follows the toolbar pills.

The preview is a faithful run of the survey logic: routing, visibility, rosters, piping, and edits
all behave exactly as they will for a respondent — so use it to test skip patterns and edits as you
build.

---

## The JSON Spec panel

The **JSON Spec** tab displays the instrument's complete JSON, with validation and import/export tools.

- **Validation status** — a green "✓ Instrument is valid" banner, or a red list of issues with the
  exact path and message (e.g. a question pointing at a missing variable, or a code question with no
  category scheme). This validates **live** as you edit, catching broken references immediately.
- **⬇ Download instrument.json** — save the instrument to a file (also available via the **Export ▾**
  menu in the toolbar).
- **⬇ JSON Schema** — download the generated JSON Schema (for validating instruments elsewhere).
- **Import instrument JSON** — load an existing instrument from a JSON file. Click the input area,
  paste JSON or upload a file, and click **Validate & load**. If valid, it replaces the current
  document; if invalid, you'll see precise error messages.
- **Live JSON** — the full instrument, always reflecting the current state. Copy/paste to share or
  archive.

> **Saving your work:** If you opened this designer from the hub (via a "Designer" module link or
> with `?survey=<id>`), click the **Save** button in the toolbar to persist your edits to the hub's
> database. Otherwise, download the instrument JSON regularly to avoid losing work if your browser
> session closes or refreshes.

---

## Render mode

Click **▶ Render** in the toolbar to run the **full respondent experience** of the instrument
you're editing, in the same window: page-by-page navigation, hard-edit gating, language toggle, and
a **Submit** that shows the collected responses as data. Click **← Designer** to return to
authoring.

Use Render for a quick end-to-end walkthrough. For the standalone respondent app with access codes
and resume, see the [respondent app manual](respondent-app.md).

---

## Worked examples

### Add a simple question
1. In the tree, click **⊕** on the page (or section) you want it in → **Question**.
2. In the **Variables** tab, click **+ Variable**, name it, set its representation, then return to
   the question and set **Collects variable** to it.
3. Fill **Question text** (each language), choose a **Response domain**, set **Required** if needed.
4. Check the **Preview** to see it render.

### Show a page only to some respondents
1. Select the page in the tree.
2. In **Visible when**, enter a condition, e.g. `$lfStatus == "emp" || $lfStatus == "abs"`.
3. In Preview, change the controlling answer and watch the page appear/disappear (the page count
   updates live).

### Add a "mark all that apply" question
1. Add a **Question**; set **Response domain → Type → markAll**.
2. Choose a **Category scheme** and set a **Variable prefix** (e.g. `srch`).
3. The Inspector lists the generated variables (`srch_net`, `srch_ads`, …). Each stores 1/2 per the
   dichotomous codes.

### Add a soft range check
1. Select a numeric question → **Validation edits → + Add edit**.
2. Severity **soft**; **Fires when** `$hoursUsual > 80`; write the **Message**.
3. In Preview, enter a large value to see the warning (it warns but doesn't block).

---

## Tips & gotchas

- **Link the variable.** A question with no **Collects variable** won't store anything and may flag
  a validation issue. Create the variable first.
- **Code questions need a scheme.** Choosing *code* / *lookup* / *markAll* requires selecting a
  **Category scheme**; otherwise the JSON Spec panel will flag it.
- **Page vs. section.** Tick **Is a page** only where you want a screen break. Too many pages =
  lots of clicking for respondents; too few = long scrolling screens.
- **Edits fire on *true*.** Write the *violation* condition (when it should complain), not the
  valid condition.
- **Watch the validation banner.** Keep the JSON Spec tab green; red issues are exactly what would
  break the survey at runtime.
- **Save your work.** Download `instrument.json` regularly — there is no auto-save server in this
  iteration.
- **Test with Preview and Render.** Preview is great for poking at one screen; Render is the honest
  end-to-end walkthrough.
