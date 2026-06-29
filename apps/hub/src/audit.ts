/**
 * Audit logging — fire-and-forget writes to Supabase `audit_log`.
 * Never throws; audit events must never block the UI.
 *
 * Supabase table (run once in the dashboard or via migration):
 *   create table audit_log (
 *     id bigint generated always as identity primary key,
 *     ts timestamptz not null default now(),
 *     actor text not null default 'anon',
 *     action text not null,
 *     entity_type text not null,
 *     entity_id text,
 *     payload_json jsonb
 *   );
 *   alter table audit_log enable row level security;
 *   create policy "anon insert" on audit_log for insert to anon with check (true);
 *   create policy "anon select" on audit_log for select to anon using (true);
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type AuditAction =
  | 'survey.create'
  | 'survey.publish'
  | 'survey.unpublish'
  | 'survey.delete'
  | 'responses.export'
  | 'responses.export_redacted'
  | 'paradata.export'
  | 'ddi.import'
  | 'ddi.export';

export function logAudit(
  action: AuditAction,
  entityType: 'survey' | 'responses' | 'paradata',
  entityId: string,
  payload?: Record<string, unknown>,
): void {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  void sb.from('audit_log').insert({
    action,
    entity_type: entityType,
    entity_id: entityId,
    payload_json: payload ?? null,
  });
}
