/**
 * Automated Reviewer Agent & Human Audit Sampler for Candidate Lineage Edges
 *
 * Implements the two-stage review pattern:
 * 1. Automated Review Agent: Audits all candidate edges for hallucinations,
 *    verifies verbatim textual grounding, checks same-cycle resolution, and flags anomalies.
 * 2. Human Audit Sampler: Selects a stratified sample of exactly 10 representative
 *    cases (simple, multi-input, unresolvable, and edge-cases) for fast human sign-off.
 * 3. Export to Supabase SQL: Generates idempotent INSERT statements for verified edges.
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { buildOccurrenceLookup, edgeDedupeKey, ensureEdgeDedupeSchema } from './queue.js';
import { buildQuestionNameAliasIndex } from './aliases.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(HERE, '..', '..');
const DB_PATH = path.join(PACKAGE_DIR, 'out', 'derivation_queue.db');
const SAMPLE_DOC_PATH = path.join(PACKAGE_DIR, 'out', 'human_review_sample_10.md');
const SQL_EXPORT_PATH = path.join(PACKAGE_DIR, 'out', 'verified_edges.sql');

export interface CandidateEdgeRow {
  edge_id: string;
  target_record_id: string;
  target_var_name: string;
  source_record_id: string | null;
  source_var_name: string;
  survey_group: string;
  cycle: string;
  derivation_type: string;
  expression_summary: string;
  raw_evidence: string;
  extraction_method: string;
  confidence: number;
  review_status: string;
  created_at: number;
  auditor?: string | null;
  audit_notes?: string | null;
}

/**
 * Checks whether a candidate variable appears as a whole-word identifier in the evidence note.
 * Uses identifier boundary [^A-Z0-9_] so that a hallucinated "AGE" does not pass on a note
 * that only mentions "AGEGRP" or "DAGE".
 */
export function isTextuallyGrounded(sourceVarName: string, evidence: string): boolean {
  const trimmed = sourceVarName.trim();
  if (!trimmed) return false;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wholeWordRe = new RegExp(`(^|[^A-Z0-9_])${escaped}([^A-Z0-9_]|$)`, 'i');
  return wholeWordRe.test(evidence);
}

/**
 * Checks whether a candidate variable (e.g. C13B) falls within an alphanumeric
 * range expression in the text note (e.g. "C13A to C13X" or "ADL_01 to ADL_05").
 */
export function matchesTextualRange(srcVar: string, noteText: string): boolean {
  // Separators must be whitespace-delimited words (English "to"/"through", French
  // "à"/"a"/"au") or a bare hyphen/dash. Requiring spaces around the single-letter
  // French "a" stops it from hijacking letters inside ordinary words ([A-Z0-9_] is
  // case-insensitive here, so "from ADL_01" would otherwise parse as FROM–DL_01).
  const rangeRegex =
    /([A-Za-z0-9_]+)(?:\s+(?:jusqu['’]à|through|to|au|à)\s+|\s+a\s+|\s*[-–—]\s*)([A-Za-z0-9_]+)/gi;
  let match;
  while ((match = rangeRegex.exec(noteText)) !== null) {
    const startRaw = match[1];
    const endRaw = match[2];
    if (!startRaw || !endRaw) continue;
    const start = startRaw.toUpperCase();
    const end = endRaw.toUpperCase();

    // Alphabetical suffix range: e.g. C13A to C13X
    const alphaMatchStart = start.match(/^([A-Z0-9_]*?)([A-Z])$/);
    const alphaMatchEnd = end.match(/^([A-Z0-9_]*?)([A-Z])$/);
    const targetMatch = srcVar.toUpperCase().match(/^([A-Z0-9_]*?)([A-Z])$/);

    if (alphaMatchStart?.[1] && alphaMatchStart[2] && alphaMatchEnd?.[1] && alphaMatchEnd[2] && targetMatch?.[1] && targetMatch[2]) {
      const prefix = alphaMatchStart[1];
      if (alphaMatchEnd[1] === prefix && targetMatch[1] === prefix) {
        const startLetter = alphaMatchStart[2].charCodeAt(0);
        const endLetter = alphaMatchEnd[2].charCodeAt(0);
        const targetLetter = targetMatch[2].charCodeAt(0);
        if (targetLetter >= startLetter && targetLetter <= endLetter) {
          return true;
        }
      }
    }

    // Numeric suffix range: e.g. Q01 to Q10 or ADL_01 through ADL_05
    const numMatchStart = start.match(/^([A-Z0-9_]*?)([0-9]+)$/);
    const numMatchEnd = end.match(/^([A-Z0-9_]*?)([0-9]+)$/);
    const numTarget = srcVar.toUpperCase().match(/^([A-Z0-9_]*?)([0-9]+)$/);
    if (numMatchStart?.[2] && numMatchEnd?.[1] && numMatchEnd[2] && numTarget?.[2]) {
      const prefix = numMatchStart[1] ?? '';
      if (numMatchEnd[1] === prefix && (numTarget[1] ?? '') === prefix) {
        const startNum = parseInt(numMatchStart[2], 10);
        const endNum = parseInt(numMatchEnd[2], 10);
        const targetNum = parseInt(numTarget[2], 10);
        if (targetNum >= startNum && targetNum <= endNum) {
          return true;
        }
      }
    }

    // Prefix + Number + Suffix range: e.g. E14A to E28A
    const midNumStart = start.match(/^([A-Z_]+)([0-9]+)([A-Z_]*)$/);
    const midNumEnd = end.match(/^([A-Z_]+)([0-9]+)([A-Z_]*)$/);
    const midNumTarget = srcVar.toUpperCase().match(/^([A-Z_]+)([0-9]+)([A-Z_]*)$/);
    if (midNumStart?.[1] && midNumStart[2] && midNumEnd?.[1] && midNumEnd[2] && midNumTarget?.[1] && midNumTarget[2]) {
      const p1 = midNumStart[1];
      const s1 = midNumStart[3] ?? '';
      if (midNumEnd[1] === p1 && (midNumEnd[3] ?? '') === s1 && midNumTarget[1] === p1 && (midNumTarget[3] ?? '') === s1) {
        const startNum = parseInt(midNumStart[2], 10);
        const endNum = parseInt(midNumEnd[2], 10);
        const targetNum = parseInt(midNumTarget[2], 10);
        if (targetNum >= startNum && targetNum <= endNum) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Expands a range token that arrived as the source variable name itself
 * (e.g. "E14A-E28A", "C13A-C13X", "Q01-Q10") into its member variables.
 * Returns null when the token is not a recognizable range.
 */
export function expandRangeToken(token: string): string[] | null {
  const m = token
    .toUpperCase()
    .match(/^([A-Z0-9_]*?)([0-9]+)?([A-Z]?)-\s*([A-Z0-9_]*?)([0-9]+)([A-Z]?)$/);
  if (!m) return null;
  const p1 = m[1] ?? '';
  const n1 = m[2];
  const s1 = m[3] ?? '';
  const p2 = m[4] ?? '';
  const n2 = m[5];
  const s2 = m[6] ?? '';
  if (!n2 || p1 !== p2) return null;

  const enumerateNums = (startStr: string, endStr: string, suffix: string): string[] | null => {
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 500) return null;
    const width = startStr.length;
    return Array.from(
      { length: end - start + 1 },
      (_, i) => `${p1}${String(start + i).padStart(width, '0')}${suffix}`
    );
  };

  // Numeric suffix range: Q01-Q10 (no alpha suffix on either side)
  if (!s1 && !s2 && n1) return enumerateNums(n1, n2, '');

  // Prefix+Number+Suffix range: E14A-E28A (same numeric width and alpha suffix)
  if (s1 && s2 === s1 && n1) return enumerateNums(n1, n2, s1);

  // Alphabetical suffix range with equal stems: C13A-C13X
  if (s1 && s2 && n1 === n2) {
    const start = s1.charCodeAt(0);
    const end = s2.charCodeAt(0);
    if (end < start || end - start > 26) return null;
    return Array.from({ length: end - start + 1 }, (_, i) => `${p1}${n1}${String.fromCharCode(start + i)}`);
  }

  return null;
}

/**
 * Finds published component columns for an unresolved questionnaire item token.
 * StatCan splits instrument items into public components, e.g. question A02 (a date)
 * publishes as A02_DOB / A02_MOB / A02_YOB, and question A03 publishes as A03A/B/C.
 * Matches `{src}_{suffix}` and single-letter-suffix forms (`{src}X`), but never
 * digit suffixes (so 'A0' does not match 'A02').
 */
export function findComponentSiblings(srcVar: string, varNames: Iterable<string>): string[] {
  const src = srcVar.toUpperCase();
  const out: string[] = [];
  for (const name of varNames) {
    if (name === src) continue;
    if (name.startsWith(src + '_')) {
      out.push(name);
    } else if (name.length === src.length + 1 && name.startsWith(src)) {
      const last = name.charCodeAt(name.length - 1);
      if (last >= 65 && last <= 90) out.push(name); // A-Z only
    }
  }
  return out.sort();
}

export class ReviewerAgent {
  private db: DatabaseSync;

  constructor(dbPath: string = DB_PATH) {
    this.db = new DatabaseSync(dbPath);
    this.ensureReviewColumns();
    ensureEdgeDedupeSchema(this.db);
  }

  private ensureReviewColumns() {
    // Add review columns to candidate_edge if not already present
    try {
      this.db.exec(`
        ALTER TABLE candidate_edge ADD COLUMN audit_notes TEXT;
        ALTER TABLE candidate_edge ADD COLUMN auditor TEXT;
      `);
    } catch {
      // Columns already exist
    }
  }

  /**
   * Run automated audit on all unreviewed candidate edges.
   * Re-passes while range-token expansion keeps producing new candidates (bounded).
   */
  public async auditCandidates(): Promise<{ verifiedCount: number; flaggedCount: number; rejectedCount: number }> {
    const totals = { verifiedCount: 0, flaggedCount: 0, rejectedCount: 0 };
    for (let pass = 0; pass < 3; pass++) {
      const r = await this.auditPass();
      totals.verifiedCount += r.verifiedCount;
      totals.flaggedCount += r.flaggedCount;
      totals.rejectedCount += r.rejectedCount;
      if (r.expandedEdges === 0) break;
    }
    console.log(`Audit complete:`);
    console.log(`  - Verified (Clean):  ${totals.verifiedCount}`);
    console.log(`  - Needs Review:      ${totals.flaggedCount}`);
    console.log(`  - Rejected (False):  ${totals.rejectedCount}`);
    return totals;
  }

  private async auditPass() {
    const candidates = this.db
      .prepare(`SELECT * FROM candidate_edge WHERE review_status = 'candidate'`)
      .all() as unknown as CandidateEdgeRow[];

    if (candidates.length > 0) console.log(`Reviewer Agent auditing ${candidates.length} candidate edges...`);

    // Lookup index used to resolve range-token members (e.g. E14A-E28A -> E14A..E28A)
    // and question-item components (e.g. A02 -> A02_DOB/_MOB/_YOB) against real
    // published-dataset record IDs, same key format as the extraction queue.
    let indexesPromise: Promise<{ byName: Map<string, string>; namesByCycle: Map<string, Set<string>> }> | null = null;

    const getIndexes = () => {
      if (!indexesPromise) {
        indexesPromise = buildOccurrenceLookup().then((byName) => {
          const namesByCycle = new Map<string, Set<string>>();
          for (const key of byName.keys()) {
            const idx = key.lastIndexOf(':');
            const cycleKey = key.slice(0, idx);
            const name = key.slice(idx + 1);
            let set = namesByCycle.get(cycleKey);
            if (!set) {
              set = new Set();
              namesByCycle.set(cycleKey, set);
            }
            set.add(name);
          }
          return { byName, namesByCycle };
        });
      }
      return indexesPromise;
    };

    // Dictionary-stated Question Name aliases (ALC_Q45 -> ALC_45), built lazily once.
    let aliasPromise: Promise<Map<string, Map<string, Set<string>>>> | null = null;
    const getAliases = () => {
      if (!aliasPromise) aliasPromise = buildQuestionNameAliasIndex();
      return aliasPromise;
    };

    const updateStmt = this.db.prepare(`
      UPDATE candidate_edge
      SET review_status = ?, confidence = ?, audit_notes = ?, auditor = ?
      WHERE edge_id = ?
    `);

    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO candidate_edge (
        edge_id, dedupe_key, target_record_id, target_var_name, source_record_id, source_var_name,
        survey_group, cycle, derivation_type, expression_summary, raw_evidence,
        extraction_method, confidence, review_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?)
    `);

    // Retargeted component edges are grounded in the published dataset (resolved
    // record ID), not verbatim prose — mark them verified at insert time.
    const insertVerifiedStmt = this.db.prepare(`
      INSERT OR IGNORE INTO candidate_edge (
        edge_id, dedupe_key, target_record_id, target_var_name, source_record_id, source_var_name,
        survey_group, cycle, derivation_type, expression_summary, raw_evidence,
        extraction_method, confidence, review_status, created_at, audit_notes, auditor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.85, 'verified', ?, ?, 'reviewer_agent_v1')
    `);

    const newEdgeId = (dedupeKey: string) =>
      crypto.createHash('sha256').update(`${dedupeKey}:reviewer`).digest('hex');

    let verifiedCount = 0;
    let flaggedCount = 0;
    let rejectedCount = 0;
    let expandedEdges = 0;
    let retargetedEdges = 0;

    for (const edge of candidates) {
      const srcUpper = edge.source_var_name.toUpperCase();

      // Check 1: Self-referential loop
      if (edge.target_var_name.toUpperCase() === srcUpper) {
        updateStmt.run(
          'rejected',
          0.0,
          'Self-referential loop: target variable cannot derive from itself.',
          'reviewer_agent_v1',
          edge.edge_id
        );
        rejectedCount++;
        continue;
      }

      // Check 2a: The source is itself an unexpanded range token ("E14A-E28A" == "E14A to E28A").
      // Expand it into member edges resolved against the corpus, then reject the token edge
      // as a formatting artifact (its meaning now lives in the expanded members).
      const members = expandRangeToken(srcUpper);
      if (members && members.length > 1) {
        const { byName } = await getIndexes();
        for (const member of members) {
          const key = `${edge.survey_group}:${edge.cycle}:${member}`;
          const recordId = byName.get(key) ?? null;
          // Only emit members that actually exist in this survey/cycle.
          if (!recordId) continue;
          const dedupeKey = edgeDedupeKey({
            survey_group: edge.survey_group,
            cycle: edge.cycle,
            target_var_name: edge.target_var_name,
            source_var_name: member,
            derivation_type: edge.derivation_type,
          });
          insertStmt.run(
            newEdgeId(dedupeKey),
            dedupeKey,
            edge.target_record_id,
            edge.target_var_name,
            recordId,
            member,
            edge.survey_group,
            edge.cycle,
            edge.derivation_type,
            edge.expression_summary,
            edge.raw_evidence,
            edge.extraction_method,
            edge.confidence,
            Date.now()
          );
          expandedEdges++;
        }
        updateStmt.run(
          'rejected',
          0.1,
          `Range token '${edge.source_var_name}' auto-expanded into member edges (hyphen is a range separator, not a variable name).`,
          'reviewer_agent_v1',
          edge.edge_id
        );
        rejectedCount++;
        continue;
      }

      // Check 2b: Verbatim textual grounding (whole-word) OR valid alphanumeric range expansion
      const mentionedInText = isTextuallyGrounded(edge.source_var_name, edge.raw_evidence);

      const inRangeExpansion = !mentionedInText && matchesTextualRange(srcUpper, edge.raw_evidence);

      if (!mentionedInText && !inRangeExpansion) {
        updateStmt.run(
          'rejected',
          0.1,
          `Hallucination check failed: source '${edge.source_var_name}' not found verbatim or within range in note text.`,
          'reviewer_agent_v1',
          edge.edge_id
        );
        rejectedCount++;
        continue;
      }

      // Check 3: Same-cycle existence resolution
      if (edge.source_record_id !== null) {
        // Source variable was successfully matched to an existing dataset column in that cycle
        const note = inRangeExpansion
          ? 'Grounded via alphanumeric range expansion and verified in published survey dataset.'
          : 'Grounded verbatim in text and resolved against published survey dataset column.';
        updateStmt.run(
          'verified',
          inRangeExpansion ? 0.95 : 0.98,
          note,
          'reviewer_agent_v1',
          edge.edge_id
        );
        verifiedCount++;
      } else {
        // Check 3b: Unresolved question-item token — StatCan often publishes an
        // instrument item only as component columns (A02 date -> A02_DOB/_MOB/_YOB,
        // A03 -> A03A/B/C). Retarget the edge onto those published components.
        const { byName, namesByCycle } = await getIndexes();
        const cycleKey = `${edge.survey_group}:${edge.cycle}`;
        const siblings = findComponentSiblings(srcUpper, namesByCycle.get(cycleKey) ?? []);
        if (siblings.length > 0) {
          for (const sib of siblings) {
            const recordId = byName.get(`${cycleKey}:${sib}`) ?? null;
            if (!recordId) continue;
            const dedupeKey = edgeDedupeKey({
              survey_group: edge.survey_group,
              cycle: edge.cycle,
              target_var_name: edge.target_var_name,
              source_var_name: sib,
              derivation_type: edge.derivation_type,
            });
            insertVerifiedStmt.run(
              newEdgeId(dedupeKey),
              dedupeKey,
              edge.target_record_id,
              edge.target_var_name,
              recordId,
              sib,
              edge.survey_group,
              edge.cycle,
              edge.derivation_type,
              edge.expression_summary,
              edge.raw_evidence,
              edge.extraction_method,
              Date.now(),
              `Retargeted from unpublished question item '${edge.source_var_name}' to published component column.`
            );
            retargetedEdges++;
          }
          updateStmt.run(
            'rejected',
            0.1,
            `Question item '${edge.source_var_name}' is not published as a column; auto-retargeted to component columns (${siblings.join(', ')}).`,
            'reviewer_agent_v1',
            edge.edge_id
          );
          rejectedCount++;
          continue;
        }

        // Check 3c: The dictionary itself states the connection — RDC/master-file data
        // dictionaries print each column's collection-instrument `Question Name` beside its
        // published `Variable Name` (ALC_Q45 -> ALC_45). Retarget onto every aliased column
        // that exists as a record in this survey/cycle. Deterministic, no LLM involved.
        const aliases = await getAliases();
        const perSurvey = aliases.get(edge.survey_group);
        // Match raw or underscore-normalized ('CAN_Q30A' cites 'CAN_Q30_A').
        const aliasVars = perSurvey?.get(srcUpper) ?? perSurvey?.get(srcUpper.replace(/_/g, ''));
        if (aliasVars && aliasVars.size > 0) {
          const resolved: string[] = [];
          for (const av of [...aliasVars].sort()) {
            const recordId = byName.get(`${cycleKey}:${av}`);
            if (!recordId) continue;
            const dedupeKey = edgeDedupeKey({
              survey_group: edge.survey_group,
              cycle: edge.cycle,
              target_var_name: edge.target_var_name,
              source_var_name: av,
              derivation_type: edge.derivation_type,
            });
            insertVerifiedStmt.run(
              newEdgeId(dedupeKey),
              dedupeKey,
              edge.target_record_id,
              edge.target_var_name,
              recordId,
              av,
              edge.survey_group,
              edge.cycle,
              edge.derivation_type,
              edge.expression_summary,
              edge.raw_evidence,
              edge.extraction_method,
              Date.now(),
              `Retargeted via dictionary Question Name '${edge.source_var_name}' -> published Variable Name.`
            );
            resolved.push(av);
          }
          if (resolved.length > 0) {
            updateStmt.run(
              'rejected',
              0.1,
              `Question item '${edge.source_var_name}' is the dictionary Question Name of published column(s) ${resolved.join(', ')}; edge retargeted.`,
              'reviewer_agent_v1',
              edge.edge_id
            );
            rejectedCount++;
            continue;
          }
        }
        // Source variable mentioned in text, but could not be resolved to a PUMF column (e.g. confidential master file or question label)
        updateStmt.run(
          'needs_review',
          0.7,
          'Grounded in note text, but source variable is not in published public file (likely master file or question label).',
          'reviewer_agent_v1',
          edge.edge_id
        );
        flaggedCount++;
      }
    }

    if (expandedEdges > 0) console.log(`  - Expanded ${expandedEdges} member edges from range tokens.`);
    if (retargetedEdges > 0) console.log(`  - Retargeted to ${retargetedEdges} component-column edges.`);

    return { verifiedCount, flaggedCount, rejectedCount, expandedEdges };
  }

  /**
   * Generates a stratified sample of 10 items for quick human review
   */
  public generateHumanReviewSample(count: number = 10) {
    const verified = this.db
      .prepare(`SELECT * FROM candidate_edge WHERE review_status = 'verified' LIMIT 5`)
      .all() as unknown as CandidateEdgeRow[];

    const flagged = this.db
      .prepare(`SELECT * FROM candidate_edge WHERE review_status = 'needs_review' LIMIT 3`)
      .all() as unknown as CandidateEdgeRow[];

    const rejected = this.db
      .prepare(`SELECT * FROM candidate_edge WHERE review_status = 'rejected' LIMIT 2`)
      .all() as unknown as CandidateEdgeRow[];

    const samples = [...verified, ...flagged, ...rejected].slice(0, count);

    let md = `# Stratified Human Review Sample (10 Entries)\n\n`;
    md += `Generated on: ${new Date().toISOString()}\n`;
    md += `Target: Quick human sign-off before publishing edges to Supabase.\n\n`;
    md += `| # | Status | Target Variable | Source Variable | Survey & Cycle | Proposed Formula / Logic | Action |\n`;
    md += `|---|---|---|---|---|---|---|\n`;

    samples.forEach((s, idx) => {
      const statusBadge =
        s.review_status === 'verified'
          ? '✅ Verified'
          : s.review_status === 'needs_review'
            ? '⚠️ Flagged'
            : '❌ Rejected';

      const logicSnippet = (s.expression_summary || s.raw_evidence)
        .replace(/\|/g, '-')
        .replace(/\n/g, ' ')
        .slice(0, 80);

      md += `| ${idx + 1} | ${statusBadge} | **${s.target_var_name}** | \`${s.source_var_name}\` | ${s.survey_group} (${s.cycle}) | ${logicSnippet}... | [ ] Approve |\n`;
    });

    md += `\n## Sample Details & Raw Evidence\n\n`;

    samples.forEach((s, idx) => {
      md += `### ${idx + 1}. Variable: \`${s.target_var_name}\` $\\leftarrow$ \`${s.source_var_name}\`\n`;
      md += `- **Survey / Cycle**: ${s.survey_group} (${s.cycle})\n`;
      md += `- **Reviewer Status**: \`${s.review_status}\` (Confidence: ${s.confidence})\n`;
      md += `- **Resolved to Column**: ${s.source_record_id ? 'Yes (UUID: ' + s.source_record_id + ')' : 'No (Master file or question code)'}\n`;
      md += `- **Raw Evidence Note**:\n`;
      md += `  > *"${s.raw_evidence}"*\n`;
      md += `- **Extracted Summary**: ${s.expression_summary}\n\n`;
    });

    writeFileSync(SAMPLE_DOC_PATH, md, 'utf8');
    console.log(`Human review sample of 10 items written to: ${SAMPLE_DOC_PATH}`);
    return SAMPLE_DOC_PATH;
  }

  /**
   * Export verified candidate edges to a Supabase-ready SQL migration file
   */
  public exportVerifiedToSQL(): string {
    const verified = this.db
      .prepare(`SELECT * FROM candidate_edge WHERE review_status = 'verified'`)
      .all() as unknown as CandidateEdgeRow[];

    const sql = renderVerifiedSql(verified);
    writeFileSync(SQL_EXPORT_PATH, sql, 'utf8');
    console.log(`Exported ${verified.filter(isPublishableEdge).length} publishable pairs from ${verified.length} auto-verified candidates to: ${SQL_EXPORT_PATH}`);
    return SQL_EXPORT_PATH;
  }
}

/**
 * Resolve the reviewer’s bilingual occurrence IDs to the English-only live corpus by exact
 * survey/cycle/document/name. Every English target occurrence receives the link; a deterministic English
 * source occurrence anchors it. Missing counterparts and same-name pairs are deliberately skipped.
 * The unique index on (target_record_id, normalized source name) makes re-imports safe.
 */
export function renderVerifiedSql(verified: readonly CandidateEdgeRow[]): string {
  const publishable = verified.filter(isPublishableEdge);
  const payload = publishable.map((edge) => ({
    target_var_name: edge.target_var_name,
    source_var_name: edge.source_var_name,
    survey_group: edge.survey_group,
    cycle: edge.cycle,
    derivation_type: edge.derivation_type,
    ai_expression_summary: edge.expression_summary,
    statcan_verbatim_note: edge.raw_evidence,
    extraction_method: edge.extraction_method,
    // Provenance: keep the actual model that minted each edge (extraction_method is 'llm_<model>').
    ai_model: edge.extraction_method.replace(/^llm_/, '') || 'qwen3.8-27b',
    confidence: edge.confidence,
  }));
  const literal = JSON.stringify(payload).replace(/'/g, "''");
  return `-- Reviewed AI-inferred lineage; apply after sql/derivation_edges.sql.
-- Input logical pairs: ${verified.length}; publishable direct-input pairs: ${publishable.length}.
-- Mixed-provenance school records, identifiers, analogies and ambiguous notes are withheld.
-- Exact survey/cycle/document/name resolution skips missing English counterparts and same-name pairs.
-- Re-running is safe because idx_derivation_target_source_name_unique is the conflict arbiter.
with incoming as materialized (
  select * from jsonb_to_recordset('${literal}'::jsonb) as i (
    target_var_name text, source_var_name text, survey_group text, cycle text,
    derivation_type text, ai_expression_summary text, statcan_verbatim_note text,
    extraction_method text, ai_model text, confidence real
  )
), english as materialized (
  select v.record_id, v.survey_group, v.cycle, v.path, upper(btrim(v.name)) as name_key
    from corpus_variable v
   where v.lang = 'en'
     and v.survey_group in (select distinct survey_group from incoming)
), source_choice as (
  select distinct on (survey_group, cycle, path, name_key)
         survey_group, cycle, path, name_key, record_id
    from english order by survey_group, cycle, path, name_key, record_id
)
insert into corpus_derivation_edge (
  target_record_id, source_record_id, source_var_name, survey_group, cycle,
  data_authority, ai_model, ai_auditor, derivation_type,
  ai_expression_summary, statcan_verbatim_note, extraction_method, confidence, review_status
)
select target.record_id, source.record_id, i.source_var_name, i.survey_group, i.cycle,
       case when i.extraction_method = 'human_review' then 'human_verified' else 'ai_inferred' end,
       i.ai_model,
       case when i.extraction_method = 'human_review' then 'human_suggestion_accept' else 'reviewer_agent_v1' end,
       i.derivation_type,
       i.ai_expression_summary, i.statcan_verbatim_note, i.extraction_method,
       i.confidence, 'verified'
  from incoming i
  join english target on target.survey_group = i.survey_group
                     and target.cycle is not distinct from i.cycle
                     and target.name_key = upper(btrim(i.target_var_name))
  join source_choice source on source.survey_group = i.survey_group
                           and source.cycle is not distinct from i.cycle
                           and source.path = target.path
                           and source.name_key = upper(btrim(i.source_var_name))
 where upper(btrim(i.target_var_name)) <> upper(btrim(i.source_var_name))
on conflict (target_record_id, (upper(btrim(source_var_name)))) do nothing;
`;
}

/** Automated verification proves a mention and column match, not always a direct input. */
export function isPublishableEdge(edge: CandidateEdgeRow): boolean {
  const source = edge.source_var_name.trim().toUpperCase();
  const target = edge.target_var_name.trim().toUpperCase();
  const evidence = edge.raw_evidence.trim().toLowerCase();
  if (edge.review_status !== 'verified') return false;
  if (edge.survey_group === 'BC_CB_K12') return false; // mixed data-source/provenance notes
  if (source === target) return false; // same-name occurrences need document-level resolution
  if (/(?:SAMPLEID|PERSONID|MASTERID|_ID)$/.test(source)) return false;
  // Human-approved suggestions (Check 4 accept) are explicitly vetted
  if (
    edge.extraction_method === 'human_review' ||
    edge.auditor === 'human_suggestion_accept' ||
    evidence.startsWith('human-approved')
  ) {
    return true;
  }
  if (/calculated the same as|this question is the same as/.test(evidence)) return false;
  return /^(?:derived based on|derived based |derived from|based on|this variable uses|this derived variable combines|if a respondent answered|the number of|this variable is derived from|derived variable to account for)/.test(evidence);
}

// CLI entrypoint
if (process.argv[1] && process.argv[1].endsWith('reviewer.ts')) {
  const agent = new ReviewerAgent();
  const cmd = process.argv[2] || 'audit';

  if (cmd === 'audit') {
    agent.auditCandidates().then(() => {
      agent.generateHumanReviewSample(10);
    });
  } else if (cmd === 'sample') {
    agent.generateHumanReviewSample(10);
  } else if (cmd === 'export') {
    agent.exportVerifiedToSQL();
  } else {
    console.log('Usage:');
    console.log('  tsx src/graph/reviewer.ts audit   (audits all candidates & generates 10-sample doc)');
    console.log('  tsx src/graph/reviewer.ts sample  (generates 10-sample doc)');
    console.log('  tsx src/graph/reviewer.ts export  (exports verified edges to Supabase SQL)');
  }
}
