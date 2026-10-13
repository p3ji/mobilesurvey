/**
 * Phase 26: Questionnaire-to-Dataset Variable Concordance Resolver
 *
 * Bridges the gap between collection-instrument question identifiers cited in data dictionary
 * derivation notes (e.g. `SED_Q12M`, `RRS_Q12`, `C19_Q18B`, `LTC_Q05_01`, `ED_Q01A`) and the
 * published analytical column names in `corpus.jsonl` (`SED12M`, `RRS_12`, `C19_18B`,
 * `LTC05_01`, `ED1Q001`).
 *
 * Also quarantines self-referential question-code citations where a collected column or
 * select-all battery item merely names its own source question (e.g. `ME_25D <- ME_Q25`
 * or `AADA_05B <- AADA_Q005B`).
 *
 * All resolved and quarantined edges follow the Two-Clause Epistemic Transparency Contract:
 *   `Evidence from data dictionary: "..."; AI interpretation and action: ...`
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CorpusVariable } from '../types.js';
import { buildQuestionNameAliasIndex } from './aliases.js';
import { evaluateDeterministicFilter, type CandidateEdgeRow } from './orchestrator.js';
import { edgeDedupeKey, ensureEdgeDedupeSchema } from './queue.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(HERE, '..', '..');
const CORPUS_JSONL = path.join(PACKAGE_DIR, 'out', 'corpus.jsonl');
const DB_PATH = path.join(PACKAGE_DIR, 'out', 'derivation_queue.db');

export interface ConcordanceResolution {
  resolvedVarName: string;
  rule: string;
}

export interface ConcordanceRunSummary {
  scannedNeedsReview: number;
  resolvedEdges: number;
  selfRefRejected: number;
  routingRejected: number;
  bySurveyGroup: Record<string, number>;
}

/**
 * Normalizes a variable or question mnemonic by stripping `_Q`, `_S`, leading zeros,
 * and underscores to detect when a target column is citing its own collection question code.
 */
export function normalizeQuestionOrVarCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/_?[QS]0*(\d)/g, '_$1')
    .replace(/_0+(\d)/g, '_$1')
    .replace(/_/g, '');
}

/**
 * Determines whether `targetVarName` is simply the dataset column (or one select-all
 * battery option column) corresponding to `sourceQuestionCode` itself, rather than a
 * derived variable computed from `sourceQuestionCode`.
 */
export function isSelfQuestionCodeReference(
  targetVarName: string,
  sourceQuestionCode: string,
  targetConcept: string,
  hasFirstBatteryOptionA: boolean,
): boolean {
  const tgt = targetVarName.trim().toUpperCase();
  const src = sourceQuestionCode.trim().toUpperCase();
  const normTgt = normalizeQuestionOrVarCode(tgt);
  const normSrc = normalizeQuestionOrVarCode(src);
  if (normTgt === normSrc) return true;

  // Battery option column (e.g. ME_25D <- ME_Q25 where ME_25A..M are options of ME_Q25)
  const isDerivedConcept = /\([DG]\)|derived/i.test(targetConcept) || /^DV_|_DV/.test(tgt);
  if (
    !isDerivedConcept &&
    normTgt.length === normSrc.length + 1 &&
    normTgt.startsWith(normSrc) &&
    /[A-Z]$/.test(tgt) &&
    hasFirstBatteryOptionA
  ) {
    return true;
  }
  return false;
}

/**
 * Generates canonical StatCan structural question-to-variable candidate names
 * for a cited collection question code (e.g. `SED_Q12M` -> `SED12M`, `SED_12M`;
 * `ED_Q01A` in LSIC cycle `1` -> `ED1Q001`, `ED1G001`).
 */
export function generateStructuralConcordanceCandidates(
  sourceQuestionCode: string,
  cycle: string = '',
): string[] {
  const src = sourceQuestionCode.trim().toUpperCase();
  const variants = new Set<string>([
    src.replace(/_[QS]0*(\d)/, '_$1'),
    src.replace(/_[QS](\d)/, '_0$1'),
    src.replace(/_[QS](\d)/, '$1'),
    src.replace(/_(\d)/, 'Q$1'),
    src.replace(/_(\d)/, '_Q$1'),
    src.replace(/_0+(\d)/, '_$1'),
    src.replace(/_(\d{2}[A-Z]?)$/, '_0$1'),
    src.replace(/^A([A-Z]{3}_)/, '$1'),
    src.replace(/^A([A-Z]{3}_)[QS]0*(\d)/, '$1$2'),
  ]);

  // Longitudinal Survey of Immigrants to Canada (LSIC) wave-infix convention:
  // Question `ED_Q01A` in wave `1`/`2`/`3` maps to `ED1Q001`, `ED1G001`, `ED1C001`
  const lsicMatch = src.match(/^([A-Z]{2})_[QS]0*(\d{1,3})([A-Z]?)$/);
  if (lsicMatch && /^[123]$/.test(cycle)) {
    const mod = lsicMatch[1]!;
    const num3 = lsicMatch[2]!.padStart(3, '0');
    const suf = lsicMatch[3] || '';
    for (const mid of ['Q', 'G', 'C', 'D']) {
      variants.add(`${mod}${cycle}${mid}${num3}${suf}`);
      if (suf) variants.add(`${mod}${cycle}${mid}${num3}`);
    }
  }

  variants.delete(src);
  return [...variants];
}

/**
 * Formats the Two-Clause Epistemic Transparency Contract for a concordance-resolved edge.
 */
export function formatConcordanceAttribution(params: {
  rawEvidence: string;
  targetVarName: string;
  originalQuestionCode: string;
  resolvedVarName: string;
  rule: string;
  surveyGroup: string;
  cycle: string;
}): string {
  const cleanEvidence = params.rawEvidence.replace(/\s+/g, ' ').trim().slice(0, 260);
  return (
    `Evidence from data dictionary: "${cleanEvidence}"; ` +
    `AI interpretation and action: Resolved questionnaire code ${params.originalQuestionCode} to published dataset variable ${params.resolvedVarName} via ${params.rule} and linked ${params.targetVarName} <- ${params.resolvedVarName} in ${params.surveyGroup} (${params.cycle}).`
  );
}

export async function runConcordanceResolver(
  options: { dryRun?: boolean; dbPath?: string } = {},
): Promise<ConcordanceRunSummary> {
  console.log('Loading corpus occurrence and note concordance index...');
  const byGroupCycle = new Map<
    string,
    Map<string, Map<string, { recordId: string; concept: string }>>
  >();
  const explicitNoteConcordance = new Map<string, Map<string, Set<string>>>();

  const rl = createInterface({
    input: createReadStream(CORPUS_JSONL, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const v = JSON.parse(line) as CorpusVariable;
    if (v.source.lang !== 'en') continue;
    const g = v.source.surveyGroup;
    const c = v.source.cycle || String(v.source.year || '');
    let cmap = byGroupCycle.get(g);
    if (!cmap) {
      cmap = new Map();
      byGroupCycle.set(g, cmap);
    }
    let vmap = cmap.get(c);
    if (!vmap) {
      vmap = new Map();
      cmap.set(c, vmap);
    }
    const upper = v.name.toUpperCase();
    vmap.set(upper, { recordId: v.recordId, concept: v.concept || '' });

    const note = (v.note || '').trim();
    for (const m of note.matchAll(
      /(?:this variable corresponds to question|corresponds to question)\s+([A-Za-z][A-Za-z0-9_]*)/gi,
    )) {
      const qCode = m[1]!.toUpperCase();
      const gcKey = `${g}:${c}`;
      let qm = explicitNoteConcordance.get(gcKey);
      if (!qm) {
        qm = new Map();
        explicitNoteConcordance.set(gcKey, qm);
      }
      let set = qm.get(qCode);
      if (!set) {
        set = new Set();
        qm.set(qCode, set);
      }
      set.add(upper);
    }
  }

  const aliasIdx = await buildQuestionNameAliasIndex();
  const db = new DatabaseSync(options.dbPath || DB_PATH);
  db.exec(`PRAGMA busy_timeout = 30000; PRAGMA journal_mode = WAL;`);
  ensureEdgeDedupeSchema(db);

  const unresolved = db
    .prepare(
      `SELECT * FROM candidate_edge WHERE review_status = 'needs_review' AND source_record_id IS NULL`,
    )
    .all() as unknown as CandidateEdgeRow[];

  const rejectStmt = db.prepare(`
    UPDATE candidate_edge
    SET review_status = 'rejected',
        auditor = 'concordance_resolver_v1',
        audit_notes = ?
    WHERE edge_id = ?
  `);

  const upsertVerifiedStmt = db.prepare(`
    INSERT INTO candidate_edge (
      edge_id, dedupe_key, target_record_id, target_var_name, source_record_id, source_var_name,
      survey_group, cycle, derivation_type, expression_summary, raw_evidence,
      extraction_method, confidence, review_status, created_at, auditor, audit_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'concordance_resolved', 0.94, 'verified', ?, 'concordance_resolver_v1', ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      source_record_id = excluded.source_record_id,
      expression_summary = excluded.expression_summary,
      extraction_method = 'concordance_resolved',
      confidence = 0.94,
      review_status = 'verified',
      auditor = 'concordance_resolver_v1',
      audit_notes = excluded.audit_notes
    WHERE candidate_edge.review_status != 'verified' OR candidate_edge.source_record_id IS NULL
  `);

  let resolvedEdges = 0;
  let selfRefRejected = 0;
  let routingRejected = 0;
  const bySurveyGroup: Record<string, number> = {};
  const now = Date.now();

  if (!options.dryRun) db.exec('BEGIN IMMEDIATE');
  try {
    for (const e of unresolved) {
      const g = e.survey_group;
      const c = e.cycle;
      const varMap = byGroupCycle.get(g)?.get(c);
      if (!varMap) continue;

      const tgt = e.target_var_name.trim().toUpperCase();
      const src = e.source_var_name.trim().toUpperCase();
      const tgtMeta = varMap.get(tgt);
      const hasFirstBatteryOptionA = varMap.has(tgt.slice(0, -1) + 'A');

      // 1. Check self-referential question code
      if (
        isSelfQuestionCodeReference(tgt, src, tgtMeta?.concept || '', hasFirstBatteryOptionA)
      ) {
        selfRefRejected++;
        if (!options.dryRun) {
          const note =
            `Evidence from data dictionary: "${e.raw_evidence.replace(/\s+/g, ' ').trim().slice(0, 220)}"; ` +
            `AI interpretation and action: Quarantined self-referential question code (${src} is the collection question identifier for ${tgt} itself, not an upstream derivation input).`;
          rejectStmt.run(note, e.edge_id);
        }
        continue;
      }

      // 2. Check deterministic non-derivation / routing filters
      const det = evaluateDeterministicFilter(tgt, src, e.raw_evidence);
      if (det && det.classification !== 'valid_dependency') {
        routingRejected++;
        if (!options.dryRun) {
          const note =
            `Evidence from data dictionary: "${e.raw_evidence.replace(/\s+/g, ' ').trim().slice(0, 220)}"; ` +
            `AI interpretation and action: Quarantined non-derivation reference (${det.rationale}).`;
          rejectStmt.run(note, e.edge_id);
        }
        continue;
      }

      if (
        /follow-up questions|this variable corresponds to question|same as question|was replaced by|not asked if|skip to/i.test(
          e.raw_evidence,
        )
      ) {
        routingRejected++;
        if (!options.dryRun) {
          const note =
            `Evidence from data dictionary: "${e.raw_evidence.replace(/\s+/g, ' ').trim().slice(0, 220)}"; ` +
            `AI interpretation and action: Quarantined questionnaire routing or equivalence note lacking computational derivation.`;
          rejectStmt.run(note, e.edge_id);
        }
        continue;
      }

      const hasDerivationCue =
        /(?:derived|based on|based upon|combines|combination of|sum of|calculated|constructed|recoded|regrouped|created from|includes respondents who|if respondent)/i.test(
          e.raw_evidence,
        ) ||
        /^DV_|_DV|D$/.test(tgt) ||
        /\([DG]\)|derived/i.test(tgtMeta?.concept || '');
      if (!hasDerivationCue) continue;

      // 3. Resolve questionnaire code via concordance hierarchy
      const matched = new Map<string, string>(); // resolvedVarName -> rule description

      if (varMap.has(src) && src !== tgt) {
        matched.set(src, 'exact dataset column match');
      }

      const dictAliases = aliasIdx.get(g)?.get(src);
      if (dictAliases) {
        for (const a of dictAliases) {
          if (varMap.has(a) && a !== tgt) {
            matched.set(a, `dictionary Question Name header concordance (${src} -> ${a})`);
          }
        }
      }

      const noteAliases = explicitNoteConcordance.get(`${g}:${c}`)?.get(src);
      if (noteAliases) {
        for (const na of noteAliases) {
          if (varMap.has(na) && na !== tgt) {
            matched.set(na, `dictionary note concordance (${src} -> ${na})`);
          }
        }
      }

      if (matched.size === 0) {
        for (const cand of generateStructuralConcordanceCandidates(src, c)) {
          if (cand !== tgt && varMap.has(cand)) {
            matched.set(cand, `structural question-to-variable concordance (${src} -> ${cand})`);
          }
        }
      }

      // Battery sub-item expansion if src is a battery question stem and target is a distinct DV
      if (matched.size === 0) {
        for (const stem of [
          src,
          src.replace(/_[QS]0*(\d)/, '_$1'),
          src.replace(/_[QS](\d)/, '_0$1'),
        ]) {
          for (const vName of varMap.keys()) {
            if (
              vName !== tgt &&
              !isSelfQuestionCodeReference(tgt, vName, tgtMeta?.concept || '', hasFirstBatteryOptionA) &&
              (new RegExp(`^${stem}[A-Z]$`).test(vName) ||
                new RegExp(`^${stem}_[A-Z0-9]{1,2}$`).test(vName))
            ) {
              matched.set(vName, `battery stem concordance (${src} -> ${vName})`);
            }
          }
        }
      }

      if (matched.size > 0) {
        for (const [resolvedVar, rule] of matched.entries()) {
          const srcEntry = varMap.get(resolvedVar);
          if (!srcEntry) continue;

          const dedupeKey = edgeDedupeKey({
            survey_group: g,
            cycle: c,
            target_var_name: tgt,
            source_var_name: resolvedVar,
            derivation_type: e.derivation_type || 'formula',
          });
          const newEdgeId = crypto
            .createHash('sha256')
            .update(`${dedupeKey}:${e.target_record_id}`)
            .digest('hex');

          const attribution = formatConcordanceAttribution({
            rawEvidence: e.raw_evidence,
            targetVarName: tgt,
            originalQuestionCode: src,
            resolvedVarName: resolvedVar,
            rule,
            surveyGroup: g,
            cycle: c,
          });

          if (!options.dryRun) {
            upsertVerifiedStmt.run(
              newEdgeId,
              dedupeKey,
              e.target_record_id,
              tgt,
              srcEntry.recordId,
              resolvedVar,
              g,
              c,
              e.derivation_type || 'formula',
              attribution,
              e.raw_evidence,
              now,
              attribution,
            );
          }
          resolvedEdges++;
          bySurveyGroup[g] = (bySurveyGroup[g] || 0) + 1;
        }

        // Mark the old unresolved question-code placeholder edge as superseded/rejected so it doesn't linger in needs_review
        if (!options.dryRun) {
          const resolvedList = [...matched.keys()].slice(0, 8).join(', ');
          const supersedeNote =
            `Evidence from data dictionary: "${e.raw_evidence.replace(/\s+/g, ' ').trim().slice(0, 200)}"; ` +
            `AI interpretation and action: Superseded unresolved question code ${src} by verified dataset column edge(s): ${resolvedList}.`;
          rejectStmt.run(supersedeNote, e.edge_id);
        }
      }
    }

    if (!options.dryRun) db.exec('COMMIT');
  } catch (err) {
    if (!options.dryRun) db.exec('ROLLBACK');
    throw err;
  } finally {
    db.close();
  }

  return {
    scannedNeedsReview: unresolved.length,
    resolvedEdges,
    selfRefRejected,
    routingRejected,
    bySurveyGroup,
  };
}

// CLI Runner
if (process.argv[1] && process.argv[1].endsWith('concordance.ts')) {
  const dryRun = process.argv.includes('--dry-run');
  runConcordanceResolver({ dryRun }).then((res) => {
    console.log('\n=== Phase 26: Questionnaire-to-Dataset Variable Concordance Resolver ===');
    console.log(`Scanned unresolved edges: ${res.scannedNeedsReview}`);
    console.log(`Verified edges minted:    ${res.resolvedEdges} (dryRun=${dryRun})`);
    console.log(`Self-ref codes rejected:  ${res.selfRefRejected}`);
    console.log(`Routing notes rejected:   ${res.routingRejected}`);
    for (const [g, cnt] of Object.entries(res.bySurveyGroup).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      console.log(`  ${g.padEnd(36)} -> ${String(cnt).padStart(5)} verified edges`);
    }
  });
}
