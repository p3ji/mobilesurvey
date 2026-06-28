/**
 * mobilesurvey backend service.
 *
 * Implements the four integration interfaces (CMS, SessionStore, ParadataSink, SampleProvider)
 * defined in `@mobilesurvey/runtime-engine` as a small HTTP API over SQLite. The respondent
 * runtime app talks to this via fetch; when it's unreachable the app falls back to local mocks, so
 * the static demo still works.
 *
 * Session keys and paradata keys are passed as query params / body fields (not path segments)
 * because they contain `:` and `/` (e.g. `urn:ddi:…::case-0001`).
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { ParadataEvent } from '@mobilesurvey/runtime-engine';
import { lfsInstrument, demoInstrument } from '@mobilesurvey/instrument-schema';
import { Store } from './db.js';

const PORT = Number(process.env.PORT ?? 8787);
const DB_FILE = process.env.DB_FILE ?? './data/app.db';

const store = new Store(DB_FILE);
store.seed();
store.seedCati();
// Seed two default surveys: the Labour Force survey (requires an access code) and the anonymous
// Feature Demo Survey (no code needed).
store.seedSurveys([
  {
    id: 'lfs',
    title: 'Household & Employment Survey',
    instrument: lfsInstrument,
    requiresAccessCode: true,
    status: 'published',
  },
  {
    id: 'demo',
    title: 'Feature Demo Survey',
    instrument: demoInstrument,
    requiresAccessCode: false,
    status: 'published',
  },
]);

const app = new Hono();
app.use('*', cors()); // dev: allow any origin (no credentials/cookies used)

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (c) => c.json({ ok: true, service: 'mobilesurvey-api' }));

// ── CMS: access codes + status ────────────────────────────────────────────────
const resolveSchema = z.object({ accessCode: z.string().min(1) });

app.post('/api/access/resolve', async (c) => {
  const body = resolveSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'accessCode required' }, 400);

  const found = store.resolveAccessCode(body.data.accessCode);
  if (!found) return c.json(null, 404);
  return c.json({ caseId: found.id, sample: { id: found.id, fields: found.fields } });
});

const statusSchema = z.object({ status: z.string().min(1) });

app.post('/api/cases/:caseId/status', async (c) => {
  const caseId = c.req.param('caseId');
  const body = statusSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'status required' }, 400);
  // Unknown case ids (e.g. anonymous respondents) are silently accepted — not an error.
  if (store.getCase(caseId)) store.setCaseStatus(caseId, body.data.status);
  return c.body(null, 204);
});

// ── Sessions (resume) ─────────────────────────────────────────────────────────
app.get('/api/session', (c) => {
  const key = c.req.query('key');
  if (!key) return c.json({ error: 'key required' }, 400);
  return c.json({ state: store.loadSession(key) });
});

const saveSessionSchema = z.object({ key: z.string().min(1), state: z.unknown() });

app.put('/api/session', async (c) => {
  const body = saveSessionSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'key and state required' }, 400);
  store.saveSession(body.data.key, body.data.state);
  return c.body(null, 204);
});

app.delete('/api/session', (c) => {
  const key = c.req.query('key');
  if (!key) return c.json({ error: 'key required' }, 400);
  store.clearSession(key);
  return c.body(null, 204);
});

// ── Paradata ──────────────────────────────────────────────────────────────────
const paradataSchema = z.object({
  key: z.string().optional(),
  event: z.object({
    ts: z.number(),
    type: z.string(),
    payload: z.record(z.unknown()).optional(),
  }),
});

app.post('/api/paradata', async (c) => {
  const body = paradataSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'event required' }, 400);
  store.addParadata(body.data.key ?? null, body.data.event as ParadataEvent);
  return c.body(null, 204);
});

app.get('/api/paradata', (c) => {
  const key = c.req.query('key');
  if (!key) return c.json({ error: 'key required' }, 400);
  return c.json({ events: store.listParadata(key) });
});

// ── Samples (SampleProvider) ──────────────────────────────────────────────────
app.get('/api/samples', (c) =>
  c.json(store.listCases().map((r) => ({ id: r.id, fields: r.fields }))),
);

app.get('/api/samples/:id', (c) => {
  const found = store.getCase(c.req.param('id'));
  if (!found) return c.json(null, 404);
  return c.json({ id: found.id, fields: found.fields });
});

// ── Surveys (management hub) ──────────────────────────────────────────────────
app.get('/api/surveys', (c) => c.json(store.listSurveys()));

app.get('/api/surveys/:id', (c) => {
  const survey = store.getSurvey(c.req.param('id'));
  if (!survey) return c.json(null, 404);
  return c.json(survey);
});

const createSurveySchema = z.object({ title: z.string().min(1), instrument: z.unknown() });

app.post('/api/surveys', async (c) => {
  const body = createSurveySchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'title and instrument required' }, 400);
  const id = store.createSurvey({ title: body.data.title, instrument: body.data.instrument });
  return c.json({ id }, 201);
});

const updateSurveySchema = z.object({ title: z.string().optional(), instrument: z.unknown() });

app.put('/api/surveys/:id', async (c) => {
  const body = updateSurveySchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'instrument required' }, 400);
  const ok = store.updateSurvey(c.req.param('id'), {
    title: body.data.title,
    instrument: body.data.instrument,
  });
  if (!ok) return c.json({ error: 'unknown survey' }, 404);
  return c.body(null, 204);
});

const configSchema = z.object({
  requiresAccessCode: z.boolean().optional(),
  status: z.enum(['draft', 'published']).optional(),
});

app.patch('/api/surveys/:id/config', async (c) => {
  const body = configSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid config' }, 400);
  const ok = store.setSurveyConfig(c.req.param('id'), body.data);
  if (!ok) return c.json({ error: 'unknown survey' }, 404);
  return c.body(null, 204);
});

app.delete('/api/surveys/:id', (c) => {
  const ok = store.deleteSurvey(c.req.param('id'));
  if (!ok) return c.json({ error: 'unknown survey' }, 404);
  return c.body(null, 204);
});

// ── CATI: interviewers ────────────────────────────────────────────────────────
app.get('/api/interviewers', (c) => c.json(store.listInterviewers()));

const createInterviewerSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  email: z.string().email().optional(),
});

app.post('/api/interviewers', async (c) => {
  const body = createInterviewerSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'name required' }, 400);
  const id = body.data.id ?? `int-${randomUUID()}`;
  store.createInterviewer(id, body.data.name, body.data.email);
  return c.json({ id }, 201);
});

// ── CATI: cases ───────────────────────────────────────────────────────────────
app.get('/api/cases', (c) => {
  const interviewerId = c.req.query('interviewer_id');
  return c.json(store.listCasesDetailed(interviewerId ? { interviewerId } : undefined));
});

const assignSchema = z.object({ interviewerId: z.string().min(1) });

app.post('/api/cases/:caseId/assign', async (c) => {
  const body = assignSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'interviewerId required' }, 400);
  store.assignCase(c.req.param('caseId'), body.data.interviewerId);
  return c.body(null, 204);
});

const outcomeSchema = z.object({
  status: z.enum(['new', 'in_progress', 'complete', 'callback', 'refused', 'non_contact']),
  callbackAt: z.number().optional(),
  callbackNote: z.string().optional(),
});

app.post('/api/cases/:caseId/outcome', async (c) => {
  const body = outcomeSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid outcome' }, 400);
  store.setCaseOutcome(
    c.req.param('caseId'),
    body.data.status,
    body.data.callbackAt ?? null,
    body.data.callbackNote ?? null,
  );
  return c.body(null, 204);
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`[mobilesurvey-api] listening on http://localhost:${info.port}  (db: ${DB_FILE})`);
});
