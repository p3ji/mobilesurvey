# Sensor module — GPS-tagged collection & camera capture with ML-assisted coding

*Design document. Status: **S1–S4 BUILT (2026-07-18)** — all four phases implemented and
verified live (results and deviations in §8). One deployment step remains manual: creating
the `attachments` Storage bucket (DEPLOYMENT.md §9d); until then photo uploads fail
gracefully and photo questions stay skippable. The real Anthropic vision call is wired but
unexercised in this environment (no `VITE_ANTHROPIC_API_KEY`); the mock provider verified
the full suggest→correct→save UX end-to-end.*

## 1. Problem statement

Some study designs need data a keyboard can't provide:

- **Location-referenced collection** — a travel/time-use survey wants the respondent's
  coordinates when they answer ("where are you right now?"), or a field-interviewer app wants
  to verify an establishment visit actually happened at the establishment.
- **Camera-based measurement** — nutritional studies ask respondents to photograph meals; a
  recognition service estimates what the food is and how much, replacing self-reported portion
  guesses that are notoriously unreliable.

Today the instrument schema has a `file` response domain that renders a bare `<input
type=file>` and stores the literal string `"(file selected)"` — a placeholder, not a feature.
There is no location capability, no upload path, no consent machinery, and no way for a
recognition result to become analyzable variables.

Hard requirements that shape everything below:

1. **Consent is a precondition, not a courtesy.** No sensor fires without an explicit,
   recorded, per-sensor consent from the respondent — separate from (and in addition to) the
   browser's own permission prompt. Declining must leave the survey completable.
2. **Sensor readings are survey data**, not side-channel telemetry: they flow into ordinary
   variables so routing, edits, piping, the Validator, and the Analyzer all work on them
   unchanged.
3. **ML output is a suggestion, not an answer.** Recognition results are shown to the
   respondent for confirmation/correction before they are stored (human-in-the-loop — same
   posture as Validator V3's LLM assistance).
4. Exploration-only bundled surveys (`collectsData: false`) must never upload photos or
   coordinates anywhere — sensors run against local mocks, exactly like the rest of their
   backend.

## 2. Architecture at a glance

```
instrument-schema          runtime-engine              apps/runtime
┌──────────────────┐   ┌─────────────────────┐   ┌──────────────────────────┐
│ ResponseDomain   │   │ SensorServices      │   │ browser impls:           │
│  + 'geolocation' │   │  (integration iface)│   │  navigator.geolocation   │
│  + 'photo'       │──▶│  captureLocation()  │◀──│  <input capture> /       │
│ SensorConfig     │   │  capturePhoto()     │   │   getUserMedia           │
│  (per-instrument │   │  recognizePhoto()   │   │  Supabase Storage upload │
│   declaration +  │   │                     │   │  RecognitionProvider     │
│   consent text)  │   │ consent gate logic  │   │   (Anthropic vision /    │
└──────────────────┘   └─────────────────────┘   │    serverless proxy)     │
        │                        │               └──────────────────────────┘
        ▼                        ▼
  respondent-view: SensorControl components (consent card, capture UI, confirm/correct UI)
  designer: palette entries + Inspector panels + PreviewPane mock; mocks for preview
```

One new integration interface, two new response domains, one instrument-level config block.
Everything else (XState machine, expression engine, pagination, edits, session resume,
paradata) is reused as-is.

## 3. Design decisions

### D1 — Sensors are response domains, not a parallel subsystem

Two new members of the `ResponseDomain` union in `packages/instrument-schema`:

```ts
| {
    type: 'geolocation';
    /** 'point' captures once on answer; 'perPage' re-captures on each page the question's
        sequence spans (roster diaries). Default 'point'. */
    mode?: 'point' | 'perPage';
    /** Decimal places kept on lat/lon (privacy dial): 2 ≈ 1.1 km, 3 ≈ 110 m, 5 ≈ raw.
        Default 3 — deliberately NOT raw. */
    precision?: 2 | 3 | 4 | 5;
    /** Reject fixes worse than this accuracy radius (metres). */
    maxAccuracyM?: number;
    /** Allow respondent to type/pick a location manually if consent is declined or the fix
        fails. Default true — keeps the survey completable (req. 1). */
    manualFallback?: boolean;
  }
| {
    type: 'photo';
    /** Camera hint: 'environment' (back) | 'user' (front). Capture-only by default;
        `allowLibrary: true` additionally permits picking an existing photo. */
    facing?: 'environment' | 'user';
    allowLibrary?: boolean;
    maxEdgePx?: number;      // client-side downscale before upload (default 1600)
    /** Optional ML coding pass over the captured image. */
    recognition?: {
      profile: 'food' | 'document' | 'generic';
      /** Variables the confirmed result is written into (D5). */
      variablePrefix: string;
      /** Category scheme constraining the item labels the respondent confirms against
          (e.g. a food-group classification); free text allowed when unset. */
      itemSchemeRef?: Id;
      maxItems?: number;     // default 5
    };
  }
```

Why domains and not new construct types: a sensor reading *answers a question* ("Where are
you?", "What did you eat?"). Modeling it as a domain means `QuestionConstruct`, `visibleWhen`,
`edits`, `required`, rosters/loops (photograph *each* meal in a diary loop) and the designer's
question plumbing all apply for free. This mirrors how `table` and `grid` were added.

### D2 — Variables: every capture explodes into flat, typed variables

Following the `markAll`/`grid` precedent (auto-generated `{prefix}_{suffix}` variables), so the
expression engine, Validator, and Analyzer see ordinary numerics/text — no new value shapes:

- `geolocation` question with variable `LOC` →
  `LOC_LAT`, `LOC_LON` (numeric), `LOC_ACC` (numeric, metres), `LOC_TS` (datetime),
  `LOC_SRC` (code: `gps` | `manual` | `declined`).
- `photo` question with variable `MEAL` →
  `MEAL_REF` (text: storage path — never the image bytes), `MEAL_TS` (datetime),
  `MEAL_SRC` (code: `camera` | `library` | `declined`); with recognition and
  `variablePrefix: 'MEAL'`, per confirmed item *i* (1-based):
  `MEAL_I{i}_LABEL` (text or code against `itemSchemeRef`), `MEAL_I{i}_QTY` (numeric),
  `MEAL_I{i}_UNIT` (code: g | ml | serving), `MEAL_I{i}_CONF` (numeric 0–1, the model's
  confidence *before* human confirmation), plus `MEAL_N_ITEMS`.
- The raw recognition response (pre-correction) is kept verbatim in paradata (D7), not in
  variables — the variables hold what the respondent confirmed.

Routing on sensor data is then plain expressions: `$LOC_SRC == 'gps' && $LOC_ACC <= 50`,
`$MEAL_N_ITEMS > 0`.

### D3 — Consent: declared per-instrument, enforced by the runtime, stored as data

New optional block on `Instrument` (sibling of `interviewer`):

```ts
export interface SensorConfig {
  /** Every sensor the instrument uses MUST be declared here; the runtime refuses to fire an
      undeclared sensor (defence against a mis-authored or tampered instrument). */
  sensors: Array<{
    kind: 'geolocation' | 'camera';
    /** Shown verbatim on the consent card: why, what is stored, at what precision. */
    purpose: InternationalString;
    /** Retention statement shown on the card (free text; policy enforcement is org-side). */
    retention?: InternationalString;
  }>;
}
```

Runtime behaviour:

- On first encountering a question whose domain needs sensor *k*, the runtime inserts a
  **consent card** (purpose + retention text from `SensorConfig`, Accept / Decline buttons)
  *before* the browser permission prompt is ever triggered. One consent per sensor kind per
  session; re-shown on session resume only if not previously answered.
- The decision is written to a reserved hidden variable `CONSENT_GEOLOCATION` /
  `CONSENT_CAMERA` (code: `granted` | `declined`) — so authors can route on it — and emitted
  as a paradata event with timestamp.
- Decline is a first-class path: the control renders its `manualFallback` (geolocation) or a
  skip-with-`declined`-source (photo); `required` is satisfied by the fallback answer. The
  designer warns when a sensor question is `required`, has `manualFallback: false`, and no
  `visibleWhen` escape — that combination would trap a non-consenting respondent.
- Consent can be **withdrawn** from the runtime's header menu at any time; withdrawal stops
  future captures (variables already collected stay, per standard survey practice, and the
  withdrawal is paradata-logged).
- The browser's own permission prompt remains a second, independent gate; a browser-level
  denial is recorded as `declined` with a paradata note distinguishing it from an explicit
  respondent decline.

### D4 — `SensorServices`: one new integration interface, mocked like everything else

Added to `packages/runtime-engine/src/integrations.ts` beside `CmsClient`/`SessionStore`:

```ts
export interface SensorServices {
  captureLocation(opts: { maxAccuracyM?: number; timeoutMs?: number }):
    Promise<{ lat: number; lon: number; accuracyM: number; ts: number } | { error: 'denied' | 'timeout' | 'unavailable' }>;
  /** Returns an opaque attachment ref (storage path) + local preview URL. */
  capturePhoto(opts: { facing?: string; allowLibrary?: boolean; maxEdgePx?: number },
               ctx: { surveyId: string; respondentId: string; questionId: string }):
    Promise<{ ref: string; previewUrl: string; ts: number } | { error: 'denied' | 'cancelled' | 'upload_failed' }>;
  recognizePhoto(ref: string, profile: RecognitionProfile):
    Promise<RecognitionResult>; // { items: [{ label, qty?, unit?, confidence }], modelId, latencyMs }
}
```

Implementations:

- **`apps/runtime` (real):** `navigator.geolocation.getCurrentPosition` for location;
  `<input type=file capture accept="image/*">` as the baseline camera path (works everywhere,
  zero permission code) with a `getUserMedia` in-page viewfinder as progressive enhancement;
  Supabase Storage for upload (D6); a `RecognitionProvider` for `recognizePhoto` (D5).
- **Mocks (designer preview, exploration-only surveys, tests):** fixed coordinates
  (e.g. Ottawa ±jitter), a bundled sample image, a canned recognition result. The
  `questionnaire-bot` fills sensor questions from these same mocks — scenario enumeration
  treats consent as just another branch (`granted`/`declined` both enumerated).
- Wiring follows `createBackend()` exactly: `collectsData: false` ⇒ mocks, hard stop (req. 4).

### D5 — Recognition is a pluggable provider; the default is the existing Anthropic pattern

```ts
export interface RecognitionProvider {
  recognize(imageBlob: Blob, profile: RecognitionProfile): Promise<RecognitionResult>;
}
```

- **Default (demo): Anthropic vision** via the exact `validatorLlm.ts` pattern —
  `VITE_ANTHROPIC_API_KEY`, feature hidden entirely when unset, same client-bundled-key
  SECURITY WARNING, same "serverless proxy is the production path and is not built" note.
  One vision call with a `food` prompt profile returns structured items
  (label, estimated quantity, unit, confidence) as JSON — good enough to demonstrate the
  whole pipeline without a nutrition-API contract.
- **Production-shaped alternative:** the same interface fronted by a serverless proxy that
  calls a dedicated food-recognition/nutrition API (LogMeal, Passio, Foodvisor…, all
  key-gated server-side). Choosing/contracting a vendor is explicitly out of scope; the
  provider interface is the deliverable.
- Nutrient *composition* (calories, macros) is a lookup from confirmed label+quantity against
  a food-composition table (e.g. Canadian Nutrient File) — a **derivation/Validator concern,
  post-collection**, not something the respondent confirms. Out of scope for the module;
  noted so nobody wedges it into the capture flow.
- The confirm/correct UI (respondent sees the photo + editable item list constrained by
  `itemSchemeRef`) is **mandatory whenever recognition ran** (req. 3). "Model said X,
  respondent kept X" vs "corrected to Y" is distinguishable in paradata (D7) — that
  correction rate is exactly what a methodologist will ask for.

### D6 — Photo storage: Supabase Storage bucket, path refs in answers, EXIF stripped

- Bucket `attachments`, object path `{surveyId}/{respondentId}/{questionId}-{ts}.jpg`.
  Answers store only the path (`MEAL_REF`); `answers_json` stays small and text-only.
- Client-side pipeline before upload: downscale to `maxEdgePx` via canvas re-encode — which
  **also strips all EXIF**, including the embedded GPS tag phone cameras add. Location data
  therefore *only* enters the dataset through the geolocation domain with its own consent,
  never smuggled inside a JPEG.
- Respondent sees the photo (preview) before upload and can retake — nothing uploads silently.
- Supabase specifics: bucket **private** (not public-read); `anon` gets INSERT-only storage
  policy scoped to the bucket (write-only drop-box: respondents upload but cannot list or read
  others' objects); hub/Validator views read via the same anon key + a SELECT policy
  restricted to authenticated dashboards *later* — for the demo, hub reads are acceptable
  under the public-by-design decision. **Remember the standing gotcha: new tables/buckets need
  explicit GRANTs in addition to policies** (DEPLOYMENT.md §§9b/9c pattern; storage policies
  live on `storage.objects`).
- Offline resilience: capture succeeds locally first (blob in memory + preview); upload
  retries in the background and on submit — mirrors the SessionStore resume posture. A
  submit with pending uploads blocks with a clear message rather than silently dropping refs.

### D7 — Paradata carries the sensor audit trail

New event types through the existing `ParadataSink` (no schema change — `paradata.payload_json`
is already free-form): `sensor-consent` (kind, decision), `sensor-consent-withdrawn`,
`location-captured` (accuracy, source — coordinates only at the same precision as the answer),
`photo-captured` (ref, byte size), `recognition-ran` (modelId, latency, raw items),
`recognition-corrected` (per-item kept/edited/removed/added). This gives methodologists the
consent rate, fix quality, and model correction rate without touching the response tables.

### D8 — Designer, DDI, and the rest of the toolchain

- **Designer:** two palette entries; Inspector panels for the domain fields
  (Inspector.tsx already switches on `domain.type` — same pattern as `numeric`); an
  instrument-level "Sensors & consent" panel (root-sequence Inspector, next to the DDI agency
  field) that maintains `SensorConfig` and auto-adds a declaration when the first sensor
  question is inserted. PreviewPane renders a mocked capture card (no real sensors in the
  380 px frame). EasyMode gets the photo question only (most requested), geolocation stays
  Pro-mode.
- **DDI-XML:** both domains follow the established extension route — project natively to
  TextDomain + authoritative `mst:rd` JSON (the P1 decision for `table`/`grid` applies
  verbatim; round-trip fidelity via `mst:rd`, XSD gate keeps passing with zero exporter work
  beyond the projection table). Auto-generated variables export as ordinary Variables, so
  ddigraph sees them.
- **Validation-engine:** L1/L2 checks work on the flat variables as-is (e.g. hard edit
  `$LOC_ACC > 100`); a later L4 heuristic ("photo present but zero confirmed items") is a
  Validator backlog item, not part of this module.
- **HTML questionnaire export / PDF spec:** render as "[Location capture]" / "[Photo capture:
  …purpose…]" placeholders with the consent text — the paper artifact documents the sensor
  use, which review boards will ask to see.

## 4. What does NOT change

- The XState machine, expression engine, pagination/numbering, edit firing, rosters — sensor
  questions are ordinary questions with unusual input widgets.
- `answers_json` / `responses` table shape (photo bytes never enter it).
- The `file` domain stays as-is (generic attachment, no consent ceremony) — `photo` is a
  separate domain, not a retrofit, because consent + capture + recognition semantics don't
  belong on every file input.
- Bundled exploration surveys' no-backend guarantee.

## 5. Phasing & acceptance criteria

**S1 — Schema + consent + geolocation** *(smallest end-to-end slice; no storage, no ML)*
- `geolocation` domain, `SensorConfig`, consent card, `CONSENT_*` variables, variable
  explosion, manual fallback, designer Inspector + palette + preview mock, Zod + tests.
- ✅ Accept: a demo survey question captures a real coordinate on a phone (HTTPS GitHub Pages
  build), rounded to the configured precision; declining consent still lets the survey
  submit; `LOC_*` variables appear in the Analyzer; paradata shows the consent event;
  exploration-only survey provably calls only mocks.

**S2 — Photo capture + storage**
- `photo` domain (no recognition), capture-input baseline, canvas downscale/EXIF strip,
  private `attachments` bucket + policies + GRANTs, ref-in-answer, retake, offline retry,
  hub Validator view renders the photo for a case.
- ✅ Accept: phone photo lands in the bucket at the expected path with EXIF verifiably absent;
  `MEAL_REF` in the response resolves in the hub; upload failure surfaces and blocks submit.

**S3 — Recognition + confirm/correct**
- `RecognitionProvider` interface, Anthropic-vision default (gated on the env key, security
  note verbatim), confirm/correct UI constrained by `itemSchemeRef`, `MEAL_I{i}_*` variables,
  correction paradata.
- ✅ Accept: photograph of a plate → suggested items with quantities → respondent edits one →
  stored variables reflect the edit; with no API key the photo question works with manual
  item entry only (graceful absence, same as Validator V3).

**S4 — Toolchain closure**
- questionnaire-bot fills sensor questions (both consent branches enumerated), HTML/PDF
  placeholders, DDI `mst:rd` projection + round-trip tests, EasyMode photo question,
  designer trap-warning (D3), docs.
- ✅ Accept: `pnpm test` covers all of the above; DDI export of a sensor survey still passes
  the XSD gate and round-trips deep-equal.

## 6. Explicit non-goals

- Continuous/background tracking of any kind (geofencing, movement traces, always-on
  location). `perPage` re-capture inside an active session is the ceiling.
- Other sensors (accelerometer, microphone, Bluetooth beacons) — the `SensorConfig.kind`
  union is where they'd slot in later; nothing else is future-proofed for them on purpose.
- Choosing/contracting a production food-recognition vendor; nutrient-composition lookup
  tables; any medical/diagnostic claim about the estimates.
- Native mobile apps — this is the mobile *web* runtime; capture-input + geolocation API
  cover it. (A PWA wrapper changes nothing architecturally.)
- Server-side image processing or virus scanning of uploads (flag for a real deployment's
  security review, alongside the existing RLS-hardening plan).

## 7. Decision log

- **(2026-07-17)** Sensors modeled as response domains, not parallel constructs — reuses the
  entire question toolchain (D1).
- **(2026-07-17)** Flat variable explosion (`markAll`/`grid` precedent) over structured answer
  values — keeps expression engine and Validator untouched (D2).
- **(2026-07-17)** Consent is instrument-declared, runtime-enforced, respondent-visible, and
  stored as routable data; browser permission is a second independent gate (D3).
- **(2026-07-17)** Default recognition = Anthropic vision behind the existing
  client-bundled-key demo pattern; production path = same interface behind a serverless
  proxy, not built (D5) — consistent with the Validator V3 decision.
- **(2026-07-17)** Photos: private bucket, path refs in answers, mandatory client-side
  re-encode (EXIF/GPS strip), default coordinate precision is ~110 m, never raw (D6).

## 8. Build results & deviations from the design (2026-07-18)

Implemented exactly as designed except where noted. Commits: S1 `067a426`, S2 `04d9900`,
S3 `d38a0c0`, S4 (this doc's commit).

- **Photo variables (deviation from D2):** the base variable itself holds the attachment ref
  (`representation: 'file'`), generating only `_TS`/`_SRC` — a separate `_REF` sub-variable
  was redundant once the base variable had to exist anyway (`variableRef` must name a
  declared variable). Recognition variables are as designed
  (`{prefix}_N_ITEMS`, `_I{i}_LABEL/QTY/UNIT/CONF`).
- **`geolocation.mode: 'perPage'` not built:** S1 shipped point capture only; the field was
  dropped from the schema rather than shipped inert. Add it with a real re-capture
  implementation when a diary study needs it.
- **Upload retry (simplification of D6):** no background queue — the capture uploads
  immediately, failure surfaces inline and leaves the question unanswered (retry = capture
  again). A required photo can't submit unanswered, so nothing is silently dropped.
- **Correction paradata (simplification of D7):** there is no discrete
  `recognition-corrected` event; `recognition-ran` carries the raw suggestions and the
  variables hold the confirmed list, so kept-vs-corrected is derivable by comparing the two.
- **Consent variables are root-scoped instance keys** (`CONSENT_GEOLOCATION@`) so
  `$CONSENT_GEOLOCATION` resolves in routing expressions; authoring a variable with a
  reserved consent name is a validation error, as is a "consent trap" (a required sensor
  question with no decline path — checked in `validate.ts`, surfaced in the designer).
- **Bundled-demo seeding got version+content awareness** (`apps/hub api.upsertSurvey`): the
  stored row refreshes when the shipped bundle's `version` is newer, or when versions are
  equal but content differs (bundle is source of truth for bundled surveys — this self-heals
  rows written from half-edited dev snapshots by HMR-remounted seeding effects, which
  happened twice during this build). **Bump `demoInstrument.version` on every content
  change** or the change never reaches Supabase.
- **Bot support (S4):** the enumerator answers sensor questions in two rounds — the consent
  decision (both branches enumerated outside canonical mode; routable) then a deterministic
  capture fill (incl. one confirmed recognition item). The Playwright browser-driver does
  NOT yet drive the consent/capture UI in a real browser — that rides on Phase 14's
  outstanding live-runtime work.
- **Verified live:** designer preview + render mode (mock captures, recognition
  suggest→correct→save, values read back from variables); runtime against Supabase (consent
  cards with declared text, browser-permission denial → typed fallback, EXIF-strip preview,
  upload failure recorded as `photo-upload-failed` paradata with "Bucket not found");
  consent decisions audited as `sensor-consent` paradata rows. Still to do on a real phone
  once deployed: a genuine GPS fix and camera capture over HTTPS (S1/S2 acceptance's
  on-device half), and the real Anthropic vision call (needs the API key).
