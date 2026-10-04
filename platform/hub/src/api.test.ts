import { beforeAll, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  responses: [] as Array<Record<string, unknown>>,
  paradata: [] as Array<Record<string, unknown>>,
}));

function queryFor(table: string) {
  let options: { count?: string; head?: boolean } | undefined;
  let surveyId: string | null = null;
  let cursor: string | number | null = null;
  let limit = Number.POSITIVE_INFINITY;

  const query = {
    select(_columns: string, opts?: { count?: string; head?: boolean }) { options = opts; return query; },
    eq(column: string, value: string) { if (column === 'survey_id') surveyId = value; return query; },
    order() { return query; },
    limit(value: number) { limit = value; return query; },
    gt(_column: string, value: string | number) { cursor = value; return query; },
    then(resolve: (result: { data: unknown; count?: number; error: null }) => unknown) {
      if (table === 'surveys') {
        return Promise.resolve({ data: [{
          id: 'demo', title: 'Demo', requires_access_code: false, anonymized: false,
          status: 'published', question_count: 1, updated_at: '2026-10-04T00:00:00Z',
        }], error: null }).then(resolve);
      }
      const source = table === 'responses' ? fixtures.responses : fixtures.paradata;
      const filtered = source.filter((row) => row.survey_id === surveyId);
      if (options?.head) return Promise.resolve({ data: null, count: filtered.length, error: null }).then(resolve);
      const data = filtered.filter((row) => cursor === null || (
        typeof row.id === 'number' && typeof cursor === 'number'
          ? row.id > cursor
          : String(row.id) > String(cursor)
      )).slice(0, limit);
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  return query;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: queryFor }),
}));

let api: typeof import('./api.js');
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');
  api = await import('./api.js');
});

describe('Hub response reads', () => {
  it('reads more than one API page and counts every submission', async () => {
    fixtures.responses = Array.from({ length: 1205 }, (_, i) => ({
      id: String(i).padStart(6, '0'), survey_id: 'demo', respondent_id: `r${i}`,
      submitted_at: '2026-10-04T00:00:00Z', duration_ms: null, completed: true,
      answers_json: { answer: i }, instrument_version: null, instrument_sha256: null,
    }));
    const responses = await api.fetchResponses('demo');
    expect(responses).toHaveLength(1205);
    expect(new Set(responses.map((row) => row.id)).size).toBe(1205);
    expect(responses[0]?.id).toBe('001204');
    expect((await api.listSurveys())[0]?.responseCount).toBe(1205);
  });

  it('reads every paradata event for dashboard export', async () => {
    fixtures.paradata = Array.from({ length: 1102 }, (_, i) => ({
      id: i + 1, survey_id: 'demo', session_key: null, respondent_id: `r${i}`,
      ts: '2026-10-04T00:00:00Z', type: 'submit', payload_json: null,
    }));
    const events = await api.fetchSurveyParadata('demo');
    expect(events).toHaveLength(1102);
    expect(events[0]?.id).toBe(1);
    expect(events.at(-1)?.id).toBe(1102);
  });
});
