# mobilesurvey — Testing Plan

> Comprehensive testing strategy to identify vulnerabilities, errors, edge cases, and performance issues across all packages and apps.

---

## Testing Dimensions

### 1. Unit Testing (Packages)
**Goal:** Validate individual functions, types, and logic in isolation.

#### `packages/instrument-schema`
- [ ] Zod validation: valid instruments pass, invalid ones fail with clear errors
- [ ] Bilingual `InternationalString` handling (missing languages, empty strings)
- [ ] Category schemes: dedup, missing categories, circular refs
- [ ] Expression types: empty strings, null, special chars
- [ ] Variable naming: uniqueness, reserved words, special chars
- [ ] Edit rules: invalid expressions, out-of-scope variables
- [ ] Rosters (loops): nested depth limits, count variable validation
- [ ] Response domains: type mismatches, missing refs to categories/variables

#### `packages/expression-engine`
- [ ] Valid expressions: arithmetic, comparisons, logical, functions
- [ ] Error handling: malformed syntax, undefined variables, type mismatches
- [ ] Security: injection attempts, eval bypass attempts
- [ ] Functions: count, sum, isAnswered, len, contains with edge cases
- [ ] Variable piping: `${var}` in expressions
- [ ] Short-circuit evaluation: `&&` / `||` correctness

#### `packages/runtime-engine`
- [ ] Flattening: rosters expand correctly, deep nesting
- [ ] Piping: `${var}` resolution in question text, instruction, tooltip
- [ ] Edit evaluation: hard edits block, soft edits warn
- [ ] Variable computation: derived fields, circular dependencies
- [ ] Session state: resume, save/restore, data integrity
- [ ] XState machine: state transitions, invalid inputs, edge cases

#### `packages/metadata-registry`
- [ ] Indexing: builds correctly, handles missing fields
- [ ] Search: TF-IDF cosine, stemming, synonym expansion
- [ ] Catalog: entry structure, missing metadata, duplicate IDs
- [ ] Semantic correctness: relevant results first

---

### 2. Integration Testing (Cross-Package)
**Goal:** Validate that packages work together correctly.

#### Designer ↔ Schema + Registry
- [ ] Load demo/LFS instruments: no validation errors
- [ ] Edit question: save, reload, data persisted correctly
- [ ] Library search: find and insert questions, variables, code lists
- [ ] Variable references: inspector catches undefined refs
- [ ] Expression validation: show helpful error messages

#### Designer ↔ API
- [ ] Create survey: API receives valid instrument JSON
- [ ] Save survey: API persists, designer can reload
- [ ] Load survey from hub: designer displays correctly
- [ ] Concurrent edits: last write wins (or conflict detection)

#### Runtime ↔ Schema + Runtime-Engine
- [ ] Load survey: validates, flattens, renders pages correctly
- [ ] Answer question: state updates, edit rules evaluated
- [ ] Conditional routing: visibleWhen works, pages shown/skipped
- [ ] Rosters: expand, collapse, repeat correctly
- [ ] Resume: session restored, data preserved

#### Hub ↔ API
- [ ] List surveys: correct count, sorting, metadata
- [ ] Create survey: blank instrument, can edit immediately
- [ ] Publish/unpublish: status changes, respondent link reflects it
- [ ] Toggle access code: code required/not required
- [ ] Delete survey: removed from list, cannot access

#### Runtime ↔ Hub
- [ ] Click "Launch" from hub: opens respondent app with survey loaded
- [ ] Code-gated survey: access code prompt shown, correct codes accepted
- [ ] Anonymous respondent: can complete without login
- [ ] Submit response: data sent to API (if backend logging on)

---

### 3. Security Testing
**Goal:** Identify vulnerabilities before deployment.

#### XSS (Cross-Site Scripting)
- [ ] Instrument metadata (title, description): `<script>`, `onerror`, `onclick` don't execute
- [ ] Question text with piping: `${var}` doesn't allow script injection
- [ ] Category labels: safe in dropdowns, checkboxes, radios
- [ ] User input in runtime: text response doesn't break HTML
- [ ] Error messages: safe to display on page
- Test: `<img src=x onerror=alert('xss')>` in title, question text, etc.

#### CSRF (Cross-Site Request Forgery)
- [ ] Hub → API: CORS headers correct, credentials handling
- [ ] Designer → API: same-origin or CORS with credentials
- [ ] State-changing requests: POST/PATCH/DELETE require verification
- Test: POST from different origin, should be blocked

#### SQL Injection
- [ ] API survey queries: parameterized queries (check `better-sqlite3` / `node:sqlite` usage)
- [ ] Survey ID in URL: escaped before DB query
- [ ] Access code validation: safe comparison (avoid timing attacks)
- Test: `'; DROP TABLE surveys; --` in survey ID

#### Authentication & Authorization
- [ ] Access codes: only valid codes grant respondent access
- [ ] Anonymous mode: survey must explicitly allow anonymous
- [ ] Published vs. draft: unpublished surveys not accessible via link
- [ ] Designer access: no authentication yet (assumed trusted), but data isolation if future auth added
- Test: Random access code, unpublished survey link, draft survey link

#### Sensitive Data
- [ ] `.env` not committed (check `.gitignore`)
- [ ] Session tokens not logged to client console
- [ ] Paradata doesn't leak PII (IP logged but not stored/displayed)
- [ ] Response data encrypted in transit (HTTPS in prod)

#### Dependency Vulnerabilities
- [ ] Run `npm audit` / `pnpm audit` regularly
- [ ] Pin versions (avoid `^` ranges where security matters)
- [ ] Watch for eval-like patterns in dependencies (expression-engine is safe by design)

---

### 4. Functionality Testing (End-to-End Workflows)
**Goal:** Validate key user journeys work as expected.

#### Workflow 1: Author a Survey
1. Open hub (landing page)
2. Click "+ New survey"
3. Enter title, designer opens
4. Add questions (text, code, numeric, datetime, boolean, file, markAll)
5. Add conditional routing (visibleWhen expressions)
6. Add sections/pages
7. Add rosters (nested loops)
8. Save survey
9. Return to hub (click mobilesurvey logo)
10. Verify survey appears in list
- [ ] All steps succeed, no console errors
- [ ] Survey data persists after reload

#### Workflow 2: Publish & Share Survey
1. In hub, click survey
2. Toggle "Published"
3. Toggle "Require access code"
4. Copy respondent link
5. Open link in new tab/incognito
6. If code required: enter access code, access granted
7. If code not required: immediately start survey
- [ ] Link works, respondent app loads correctly
- [ ] Access control enforced

#### Workflow 3: Complete Survey as Respondent
1. Open respondent link
2. Read instructions, language toggle works
3. Answer each question type correctly
4. Trigger soft edits (see warnings), override and proceed
5. Trigger hard edits (blocked, must fix)
6. Conditional pages shown/hidden per routing
7. Rosters expand/collapse
8. Complete and submit
9. See success screen
- [ ] All interactions responsive, no hangs
- [ ] Data validates before submit
- [ ] Response JSON is valid, parseable

#### Workflow 4: Reuse Components from Library
1. In designer, click "Library" tab
2. Search for existing questions/sections
3. Drag question into survey
4. Variables and code lists auto-copied
5. Edit question, save
- [ ] Search finds relevant results
- [ ] Copied components have unique IDs
- [ ] No orphaned variable/category refs

---

### 5. Performance Testing
**Goal:** Identify bottlenecks and limits.

#### Large Instrument (100+ questions)
- [ ] Designer loads in <2s
- [ ] Tree scrolls smoothly (virtualize if not)
- [ ] Search/filter responsive (<500ms)
- [ ] Save completes in <1s
- [ ] Render full survey in <3s

#### Large Response Set (1000+ submissions)
- [ ] API response time for /api/surveys/<id>/responses stays <1s
- [ ] Hub survey list loads in <2s (paginate if needed)

#### Deep Nesting (10+ levels of rosters)
- [ ] Flattening completes in <100ms
- [ ] Runtime page renders in <1s
- [ ] Editing nested questions doesn't lag

---

### 6. Error Handling & Edge Cases
**Goal:** Ensure graceful failures and clear error messages.

#### Missing/Invalid Data
- [ ] Instrument missing required fields: Zod error displayed
- [ ] Survey not found (404): friendly error message
- [ ] Invalid access code: clear rejection
- [ ] Network timeout: retry UI or offline mode message
- [ ] Respondent closes tab mid-survey: resume option on next visit

#### Boundary Conditions
- [ ] Empty survey: can still submit (no questions is valid)
- [ ] Question with no response domain: caught during save
- [ ] Category scheme with 0 categories: validation error
- [ ] Expression with undefined variable: caught, error shown with hint
- [ ] Circular roster: count variable depends on itself → error
- [ ] Very long question text (5000+ chars): renders without overflow
- [ ] Many response options (100+): dropdown/search UX

#### Browser Compatibility & Responsiveness
- [ ] Desktop (1920px+): full layout
- [ ] Tablet (768px): responsive design
- [ ] Mobile (375px): touch-friendly, responsive
- [ ] Respondent app on mobile: works fully
- [ ] Designer on mobile: may be limited, but doesn't crash

---

### 7. Accessibility Testing (WCAG 2.1 AA)
**Goal:** Ensure usability for all users.

#### Keyboard Navigation
- [ ] All buttons/inputs focusable via Tab
- [ ] Enter/Space activates buttons
- [ ] Escape closes modals
- [ ] No keyboard traps

#### Screen Reader (NVDA / JAWS)
- [ ] Form labels associated with inputs
- [ ] Fieldsets/legends for grouped questions
- [ ] Error messages announced
- [ ] Required field indicators clear
- [ ] Icons have `aria-label` or text alternative

#### Color Contrast
- [ ] Text vs. background: 4.5:1 (normal), 3:1 (large)
- [ ] Icons: sufficient contrast to adjacent colors
- [ ] Error states: don't rely on red alone

#### Language & Bilingual
- [ ] Both EN and FR render correctly
- [ ] RTL languages (future): check text direction
- [ ] Bilingual question text: both languages visible or toggleable

---

## Test Execution Plan

### Phase 1: Quick Smoke Tests (30 min)
Run these first to catch obvious breakage:
1. `pnpm typecheck` — all packages type-correct
2. `pnpm test` — all unit tests pass
3. Hub loads at http://localhost:5175
4. Designer loads, create a survey, save, verify in hub
5. Respondent app loads survey, complete it

### Phase 2: Security Audit (1–2 hours)
1. Check `.gitignore` for `.env`, secrets
2. Run `pnpm audit` for dependency vulns
3. Search codebase for `eval`, `innerHTML`, `dangerouslySetInnerHTML`
4. Test XSS vectors (see Security Testing section above)
5. Verify API uses parameterized queries

### Phase 3: Integration & E2E (2–3 hours)
1. Test all workflows above (6 workflows)
2. Log console errors and crashes
3. Check API responses in Network tab
4. Verify state persistence (reload pages, resume sessions)

### Phase 4: Edge Cases & Error Handling (1–2 hours)
1. Invalid inputs (malformed JSON, missing fields, special chars)
2. Boundary conditions (empty surveys, deep nesting, large text)
3. Network errors (kill backend mid-request, see error UI)

### Phase 5: Performance Baseline (30–60 min)
1. Load demo survey: measure time to interactive
2. Designer with 50 questions: measure scroll performance
3. Search 1000 registry items: measure search latency
4. Document baseline metrics

---

## Issue Tracking Template

When you find a bug, document it:

```markdown
## Issue: [Short description]

**Severity:** Critical / High / Medium / Low
**Component:** designer / runtime / hub / api / schema / expression-engine / runtime-engine
**Steps to reproduce:**
1. ...
2. ...

**Actual behavior:** [What happened]
**Expected behavior:** [What should happen]
**Screenshot/logs:** [Attach if applicable]

**Notes:** [Additional context]
```

---

## Continuous Testing

### Pre-commit
- `pnpm typecheck && pnpm test` before every commit

### Pre-push
- Manual smoke tests (above) on all three apps
- Network tab inspection for unexpected requests

### Pre-release
- Full test suite (all phases)
- Security audit
- Performance baseline comparison

---

## Tools & References

- **Vitest:** Unit tests (`pnpm test`)
- **TypeScript:** Type checking (`pnpm typecheck`)
- **Browser DevTools:** Network, Console, Performance tabs
- **OWASP Top 10:** https://owasp.org/www-project-top-ten/
- **WCAG 2.1:** https://www.w3.org/WAI/WCAG21/quickref/
