/**
 * Hub ↔ Supabase persistence for the Validator module. Mirrors the pattern in `api.ts`
 * (independent Supabase client, same env vars) rather than importing it, so this module can be
 * lifted out cleanly if the Validator ever needs its own deployment surface.
 *
 * Schema: see DEPLOYMENT.md §9b for the CREATE TABLE + RLS statements this module assumes.
 * Design rationale for the shape of everything here: docs/validator-plan.md §4, §6.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Instrument } from '@mobilesurvey/instrument-schema';
import {
  applyCorrections,
  runValidation,
  type CheckConfig,
  type Correction,
  type Disposition,
  type Suppression,
  type ValidationFlag,
  type ValidationRun,
  type ValidatorResponse,
  type ValidatorRule,
  type VariableAnnotation,
} from '@mobilesurvey/validation-engine';
import { fetchResponses, type ResponseRow } from './api.js';
import { logAudit } from './audit.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let _sb: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (!_sb) {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env vars not set');
    _sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return _sb;
}

export function validatorConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

function toResponses(rows: ResponseRow[]): ValidatorResponse[] {
  return rows.map((r) => ({
    id: r.id,
    respondentId: r.respondentId,
    submittedAt: r.submittedAt,
    durationMs: r.durationMs,
    completed: r.completed,
    answers: r.answersJson,
  }));
}

// ── Runs ──────────────────────────────────────────────────────────────────────

export async function fetchRunsForSurvey(surveyId: string): Promise<ValidationRun[]> {
  const { data, error } = await sb()
    .from('validation_runs')
    .select('id, survey_id, started_at, config_json, summary_json')
    .eq('survey_id', surveyId)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: { id: string; survey_id: string; started_at: string; config_json: CheckConfig; summary_json: ValidationRun['summary'] }) => ({
    id: r.id,
    surveyId: r.survey_id,
    startedAt: r.started_at,
    config: r.config_json,
    summary: r.summary_json,
  }));
}

export async function fetchFlagsForRun(runId: string): Promise<ValidationFlag[]> {
  const { data, error } = await sb()
    .from('validation_flags')
    .select('*')
    .eq('run_id', runId)
    .order('score', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToFlag);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToFlag(r: any): ValidationFlag {
  return {
    id: r.id,
    runId: r.run_id,
    responseId: r.response_id,
    respondentId: r.respondent_id,
    variableName: r.variable_name,
    instanceKey: r.instance_key,
    checkKind: r.check_kind,
    checkId: r.check_id,
    severity: r.severity,
    message: r.message,
    observed: r.observed_json,
    expected: r.expected ?? undefined,
    suspicion: r.suspicion,
    impact: r.impact,
    score: r.score,
  };
}

/** Status derived from a flag's disposition (or 'open' if none yet). */
export type FlagStatus = 'open' | 'accepted' | 'corrected' | 'follow_up' | 'suppressed';

export interface FlagRow {
  flag: ValidationFlag;
  status: FlagStatus;
  disposition: Disposition | null;
}

export async function fetchFlagRowsForRun(runId: string): Promise<FlagRow[]> {
  const { data, error } = await sb()
    .from('validation_flags')
    .select('*')
    .eq('run_id', runId)
    .order('score', { ascending: false });
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    flag: rowToFlag(r),
    status: (r.status as FlagStatus) ?? 'open',
    disposition: r.disposition_json ?? null,
  }));
}

/** Runs the engine over a survey's current (edited) responses and persists the result. */
export async function executeValidationRun(
  instrument: Instrument,
  surveyId: string,
  config?: Partial<CheckConfig>,
): Promise<{ run: ValidationRun; flags: ValidationFlag[] }> {
  const [rawRows, rules, suppressions, corrections] = await Promise.all([
    fetchResponses(surveyId),
    fetchRules(surveyId),
    fetchSuppressions(surveyId),
    fetchCorrections(surveyId),
  ]);
  const edited = applyCorrections(toResponses(rawRows), corrections);

  const runId = `vr-${Date.now().toString(36)}`;
  const result = runValidation({
    runId,
    surveyId,
    startedAt: new Date().toISOString(),
    instrument,
    responses: edited,
    rules,
    suppressions,
    config,
  });

  const { error: runErr } = await sb().from('validation_runs').insert({
    id: result.run.id,
    survey_id: result.run.surveyId,
    started_at: result.run.startedAt,
    config_json: result.run.config,
    summary_json: result.run.summary,
  });
  if (runErr) throw runErr;

  if (result.flags.length > 0) {
    const rows = result.flags.map((f) => ({
      id: f.id,
      run_id: f.runId,
      survey_id: surveyId,
      response_id: f.responseId,
      respondent_id: f.respondentId,
      variable_name: f.variableName,
      instance_key: f.instanceKey,
      check_kind: f.checkKind,
      check_id: f.checkId,
      severity: f.severity,
      message: f.message,
      observed_json: f.observed ?? null,
      expected: f.expected ?? null,
      suspicion: f.suspicion,
      impact: f.impact,
      score: f.score,
      status: 'open',
    }));
    const { error: flagsErr } = await sb().from('validation_flags').insert(rows);
    if (flagsErr) throw flagsErr;
  }

  logAudit('validator.run', 'validator', surveyId, {
    runId: result.run.id,
    flagCount: result.run.summary.flagCount,
    responsesAnalyzed: result.run.summary.responsesAnalyzed,
  });

  return result;
}

// ── Dispositions, corrections, suppressions ───────────────────────────────────

export async function saveDisposition(
  surveyId: string,
  flag: ValidationFlag,
  disposition: Disposition,
): Promise<void> {
  const status: FlagStatus =
    disposition.action === 'accept' ? 'accepted' :
    disposition.action === 'correct' ? 'corrected' :
    disposition.action === 'follow-up' ? 'follow_up' :
    'suppressed';

  const { error: updateErr } = await sb()
    .from('validation_flags')
    .update({ status, disposition_json: disposition })
    .eq('id', flag.id);
  if (updateErr) throw updateErr;

  if (disposition.action === 'accept' || disposition.action === 'suppress') {
    const { error } = await sb().from('validation_suppressions').insert({
      survey_id: surveyId,
      response_id: flag.responseId,
      check_id: flag.checkId,
      instance_key: flag.instanceKey,
      accepted_value_json: flag.observed ?? null,
      flag_id: flag.id,
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  if (disposition.action === 'correct' && flag.instanceKey && disposition.correctedValue !== undefined) {
    const { error } = await sb().from('validation_corrections').insert({
      id: `vc-${Date.now().toString(36)}`,
      survey_id: surveyId,
      response_id: flag.responseId,
      instance_key: flag.instanceKey,
      old_value_json: flag.observed ?? null,
      new_value_json: disposition.correctedValue,
      reason: disposition.reason,
      flag_id: flag.id,
      decided_by: disposition.decidedBy,
      decided_at: disposition.decidedAt,
    });
    if (error) throw error;
  }

  logAudit('validator.disposition', 'validator', surveyId, {
    flagId: flag.id,
    action: disposition.action,
    checkId: flag.checkId,
  });
}

export async function fetchSuppressions(surveyId: string): Promise<Suppression[]> {
  const { data, error } = await sb()
    .from('validation_suppressions')
    .select('survey_id, response_id, check_id, instance_key, accepted_value_json, flag_id')
    .eq('survey_id', surveyId);
  if (error) throw error;
  return (data ?? []).map((r: { survey_id: string; response_id: string; check_id: string; instance_key: string | null; accepted_value_json: unknown; flag_id: string }) => ({
    surveyId: r.survey_id,
    responseId: r.response_id,
    checkId: r.check_id,
    instanceKey: r.instance_key,
    acceptedValue: r.accepted_value_json,
    flagId: r.flag_id,
  }));
}

export async function fetchCorrections(surveyId: string): Promise<Correction[]> {
  const { data, error } = await sb()
    .from('validation_corrections')
    .select('*')
    .eq('survey_id', surveyId);
  if (error) throw error;
  return (data ?? []).map((r: {
    id: string; survey_id: string; response_id: string; instance_key: string;
    old_value_json: unknown; new_value_json: unknown; reason: string;
    flag_id: string | null; decided_by: string; decided_at: string;
  }) => ({
    id: r.id,
    surveyId: r.survey_id,
    responseId: r.response_id,
    instanceKey: r.instance_key,
    oldValue: r.old_value_json,
    newValue: r.new_value_json,
    reason: r.reason,
    flagId: r.flag_id ?? undefined,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
  }));
}

// ── Validator-authored rules ──────────────────────────────────────────────────

export async function fetchRules(surveyId: string): Promise<ValidatorRule[]> {
  const { data, error } = await sb()
    .from('validator_rules')
    .select('*')
    .eq('survey_id', surveyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: {
    id: string; survey_id: string; name: string; when_expr: string; message: string;
    severity: 'fatal' | 'query'; variable_name: string | null; source: ValidatorRule['source'];
    source_flag_id: string | null; active: boolean; created_at: string;
  }) => ({
    id: r.id,
    surveyId: r.survey_id,
    name: r.name,
    when: r.when_expr,
    message: r.message,
    severity: r.severity,
    variableName: r.variable_name,
    source: r.source,
    sourceFlagId: r.source_flag_id ?? undefined,
    active: r.active,
    createdAt: r.created_at,
  }));
}

export async function saveRule(input: Omit<ValidatorRule, 'id' | 'createdAt' | 'active'>): Promise<ValidatorRule> {
  const rule: ValidatorRule = {
    ...input,
    id: `vrule-${Date.now().toString(36)}`,
    active: true,
    createdAt: new Date().toISOString(),
  };
  const { error } = await sb().from('validator_rules').insert({
    id: rule.id,
    survey_id: rule.surveyId,
    name: rule.name,
    when_expr: rule.when,
    message: rule.message,
    severity: rule.severity,
    variable_name: rule.variableName,
    source: rule.source,
    source_flag_id: rule.sourceFlagId ?? null,
    active: rule.active,
    created_at: rule.createdAt,
  });
  if (error) throw error;
  logAudit('validator.rule_created', 'validator', rule.surveyId, { ruleId: rule.id, name: rule.name });
  return rule;
}

export async function setRuleActive(ruleId: string, surveyId: string, active: boolean): Promise<void> {
  const { error } = await sb().from('validator_rules').update({ active }).eq('id', ruleId);
  if (error) throw error;
  logAudit('validator.rule_toggled', 'validator', surveyId, { ruleId, active });
}

// ── Variable annotations ───────────────────────────────────────────────────────
// Free-text domain knowledge attached to a variable, independent of any run. Kept in its own
// table (not the instrument) so it evolves post-publication without touching DDI export --
// see docs/validator-plan.md §6.1 and §8.1.

export async function fetchAnnotations(surveyId: string): Promise<VariableAnnotation[]> {
  const { data, error } = await sb()
    .from('variable_annotations')
    .select('survey_id, variable_name, note, author, updated_at')
    .eq('survey_id', surveyId);
  if (error) throw error;
  return (data ?? []).map((r: { survey_id: string; variable_name: string; note: string; author: string; updated_at: string }) => ({
    surveyId: r.survey_id,
    variableName: r.variable_name,
    note: r.note,
    author: r.author,
    updatedAt: r.updated_at,
  }));
}

export async function saveAnnotation(annotation: VariableAnnotation): Promise<void> {
  const { error } = await sb().from('variable_annotations').upsert({
    survey_id: annotation.surveyId,
    variable_name: annotation.variableName,
    note: annotation.note,
    author: annotation.author,
    updated_at: annotation.updatedAt,
  }, { onConflict: 'survey_id,variable_name' });
  if (error) throw error;
}
