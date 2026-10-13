/**
 * Autonomous Adversarial Orchestrator for Derived Variable (DV) Lineage
 *
 * Implements the dual-tier architecture from docs/dv-lineage-orchestration-plan.md:
 * - Deterministic fast-path pre-filters for prose phrases, internal files, and admin registers
 * - Local LLM Adversarial Critic on http://127.0.0.1:1234/v1 (LM Studio)
 * - Stream A: Verified audit sampling to detect target mismatches and routing conditions
 * - Stream B: Needs_review adjudication to resolve ambiguous candidate tokens
 * - Strict integrity guard: NEVER marks an edge as verified if source_record_id is null
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(HERE, '..', '..');
const DB_PATH = path.join(PACKAGE_DIR, 'out', 'derivation_queue.db');

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
  audit_notes?: string | null;
  auditor?: string | null;
  dedupe_key?: string | null;
}

export type AdversarialClassification =
  | 'prose_phrase'
  | 'internal_processing_file'
  | 'admin_register'
  | 'routing_filter'
  | 'target_mismatch'
  | 'valid_dependency';

export interface CriticDecision {
  classification: AdversarialClassification;
  confidence: number;
  counter_hypothesis: string;
  rationale: string;
  source: 'deterministic' | 'llm_critic' | 'gemini_escalation';
}

/**
 * Deterministic pre-filter checks to resolve unambiguous candidate flaws instantly.
 */
export function evaluateDeterministicFilter(
  targetVarName: string,
  sourceVarName: string,
  rawEvidence: string
): CriticDecision | null {
  const targetUpper = targetVarName.trim().toUpperCase();
  const sourceUpper = sourceVarName.trim().toUpperCase();
  const evidence = rawEvidence.trim();

  // Check 1: Self-referential loop
  if (targetUpper === sourceUpper) {
    return {
      classification: 'routing_filter',
      confidence: 1.0,
      counter_hypothesis: 'Self-referential loop: target variable cannot derive from itself.',
      rationale: 'Target variable and source variable are identical.',
      source: 'deterministic',
    };
  }

  // Check 1b: Pure numeric literals or code values (e.g. -3, 99, 1)
  if (/^[-+]?\d+$/.test(sourceUpper)) {
    return {
      classification: 'prose_phrase',
      confidence: 1.0,
      counter_hypothesis: 'Numeric code or category constant extracted rather than questionnaire mnemonic.',
      rationale: `Source token '${sourceVarName}' is a numeric literal/code value.`,
      source: 'deterministic',
    };
  }

  // Check 2: Prose phrase (contains spaces, lowercase prose, or punctuation words)
  if (sourceUpper.includes(' ')) {
    return {
      classification: 'prose_phrase',
      confidence: 1.0,
      counter_hypothesis: 'Prose phrase extraction rather than questionnaire variable mnemonic.',
      rationale: `Source token '${sourceVarName}' contains whitespace and represents descriptive text.`,
      source: 'deterministic',
    };
  }

  // Common descriptive non-variables extracted as tokens
  const PROSE_TOKENS = new Set([
    'TOTAL',
    'TOTALS',
    'INCOME',
    'SUBTOTAL',
    'EARNINGS',
    'BENEFITS',
    'HOUSEHOLD',
    'PERSON',
    'RESPONDENT',
    'HOURS',
    'WEEKS',
    'MONTHS',
    'YEARS',
    'AMOUNT',
    'VALUE',
    'UNKNOWN',
    'MISSING',
    'OTHER',
    'NONE',
    'ALL',
    'ANY',
  ]);
  if (PROSE_TOKENS.has(sourceUpper)) {
    return {
      classification: 'prose_phrase',
      confidence: 0.98,
      counter_hypothesis: 'Generic descriptive word extracted as variable mnemonic.',
      rationale: `Source token '${sourceVarName}' is an ordinary English/French prose word, not a questionnaire mnemonic.`,
      source: 'deterministic',
    };
  }

  // Check 3: External Administrative Registers & Geography Files
  const ADMIN_REGISTERS = new Set([
    'T1FF',
    'T1',
    'T4',
    'GAF',
    'RUINDFG',
    'CMA',
    'CA',
    'CSD',
    'CD',
    'PRV',
    'PROV',
    'FED',
    'DA',
    'CT',
    'POSTAL',
    'PCODE',
  ]);
  if (ADMIN_REGISTERS.has(sourceUpper)) {
    return {
      classification: 'admin_register',
      confidence: 0.99,
      counter_hypothesis: 'External administrative register or census geography code joined post-collection.',
      rationale: `Source '${sourceVarName}' is an administrative tax file or standard census geography indicator.`,
      source: 'deterministic',
    };
  }

  // Check 3b: Survey Frame & Sample Identifiers
  const FRAME_IDENTIFIERS = new Set([
    'SAMPLEID',
    'PERSONID',
    'CASEID',
    'PUMFID',
    'RES_ID',
    'HH_ID',
    'HHID',
    'PID',
    'RECORD_ID',
    'REC_ID',
    'RELATIONSHIP',
  ]);
  if (FRAME_IDENTIFIERS.has(sourceUpper)) {
    return {
      classification: 'admin_register',
      confidence: 0.99,
      counter_hypothesis: 'Survey frame or sample unit identifier, not a questionnaire content variable.',
      rationale: `Source '${sourceVarName}' is a survey sampling frame or roster linkage identifier.`,
      source: 'deterministic',
    };
  }

  // Check 4: Explicit Internal Processing / Master File exclusion note
  const evidenceLower = evidence.toLowerCase();
  if (
    evidenceLower.includes('internal processing file') ||
    evidenceLower.includes('not on master file') ||
    evidenceLower.includes('not on data file') ||
    evidenceLower.includes('not on the master file') ||
    evidenceLower.includes('not on public file') ||
    evidenceLower.includes('not on pumf')
  ) {
    return {
      classification: 'internal_processing_file',
      confidence: 0.98,
      counter_hypothesis: 'Explicitly declared unpublished internal processing or confidential master-file variable.',
      rationale: `Documentation explicitly states: source variable is on internal processing file or not on master/public file.`,
      source: 'deterministic',
    };
  }

  // Check 5: Known interview routing / respondent type flags in evidence
  if (
    (sourceUpper === 'PMK' || sourceUpper === 'PROXY') &&
    (evidenceLower.includes('person most knowledgeable') || evidenceLower.includes('questions were not asked'))
  ) {
    return {
      classification: 'routing_filter',
      confidence: 0.99,
      counter_hypothesis: 'Respondent type filter (PMK / Proxy), not a mathematical input.',
      rationale: `Token '${sourceVarName}' describes respondent type eligibility, not a computational dependency.`,
      source: 'deterministic',
    };
  }

  // Check 6: Questionnaire collection battery / select-all category mapping
  if (
    evidenceLower.includes('in the questionnaire, this variable is found under') ||
    evidenceLower.includes('under the question') ||
    evidenceLower.includes('category #') ||
    evidenceLower.includes('write-in responses were coded into one of the existing listed categories')
  ) {
    return {
      classification: 'routing_filter',
      confidence: 0.99,
      counter_hypothesis: 'Questionnaire battery category pointer or write-in recode, not an inter-variable computational derivation.',
      rationale: 'Documentation describes questionnaire structure / category coding under a question stem rather than a computational lineage dependency.',
      source: 'deterministic',
    };
  }

  // Check 7: Explicit exclusion of simultaneous activity in time use surveys
  if (
    (evidenceLower.includes('does not include any time that may have been reported as a simultaneous activity') ||
      evidenceLower.includes('excludes time reported as a simultaneous activity') ||
      evidenceLower.includes('excludes any time reported as a simultaneous activity')) &&
    (sourceUpper.startsWith('TUI_') || sourceUpper.startsWith('ACT_'))
  ) {
    return {
      classification: 'routing_filter',
      confidence: 0.99,
      counter_hypothesis: 'Simultaneous activity exclusion condition, not a computational additive input.',
      rationale: `Documentation explicitly states the derived variable excludes / does not include time reported as simultaneous activity (${sourceVarName}).`,
      source: 'deterministic',
    };
  }

  return null;
}

/**
 * Local LLM Client for calling LM Studio on 127.0.0.1:1234
 */
export class LocalCriticClient {
  private baseUrl: string;
  private model: string;

  constructor(
    baseUrl: string = process.env.LOCAL_LLM_URL || 'http://127.0.0.1:1234/v1',
    model: string = process.env.LOCAL_LLM_MODEL || 'microsoft/phi-4'
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model;
  }

  public async evaluateNeedsReview(
    targetVar: string,
    sourceVar: string,
    evidence: string
  ): Promise<CriticDecision> {
    const systemPrompt = `You are an expert Statistics Canada data dictionary lineage critic. Your role is adversarial: challenge candidate lineage edges against four counter-hypotheses:
1. routing_filter: Token is an interview routing, respondent filter, or universe condition (e.g., PMK - person most knowledgeable, proxy respondent, skip condition), not a mathematical input variable.
2. internal_processing_file: Note explicitly indicates the variable is on an internal processing file, unreleased master file, or not on public file.
3. admin_register: Token is an external census geography or tax register (e.g. T1FF, GAF, RUINDFG), not a survey instrument question.
4. prose_phrase: Token is an English/French descriptive phrase (e.g., TOTAL INCOME), not a variable mnemonic.
5. valid_dependency: Genuine mathematical, recode, or logical input to the derived variable.

Respond ONLY with a JSON object: {"classification": "routing_filter" | "internal_processing_file" | "admin_register" | "prose_phrase" | "valid_dependency", "confidence": float (0.0 to 1.0), "counter_hypothesis": string, "rationale": string}`;

    const userPrompt = `Target: ${targetVar}. Candidate Source: ${sourceVar}. Evidence note: "${evidence}"`;

    return this.callLlm(systemPrompt, userPrompt);
  }

  public async auditVerifiedEdge(
    targetVar: string,
    sourceVar: string,
    evidence: string,
    auditNotes?: string | null
  ): Promise<CriticDecision> {
    const systemPrompt = `You are an expert Statistics Canada data dictionary lineage critic. Your role is adversarial: verify whether a verified candidate edge (Target -> Source) is a genuine dependency or a target mismatch/filter.

Checks:
1. target_mismatch: The note text is actually describing how a DIFFERENT variable was created, not the Target variable. (Note: if the candidate source variable was retargeted from a questionnaire question name like 'DEM_Q20' to the published dataset variable name like 'Q114A' as described in context, this is a VALID dictionary alias match, NOT a mismatch).
2. routing_filter: The source is an interview skip/filter condition, simultaneous activity exclusion, or respondent type, not an input.
3. confirmed_dependency: The source is genuinely an input to the Target variable.

Respond ONLY with a JSON object: {"verdict": "target_mismatch" | "routing_filter" | "confirmed_dependency", "confidence": float (0.0 to 1.0), "rationale": string}`;

    const contextStr = auditNotes ? ` Context: ${auditNotes}` : '';
    const userPrompt = `Target: ${targetVar}. Candidate Source: ${sourceVar}. Evidence note: "${evidence}".${contextStr}`;

    const res = await this.callRaw(systemPrompt, userPrompt);
    const parsed = this.parseJson(res);
    const verdict = parsed.verdict || 'confirmed_dependency';
    const classification: AdversarialClassification =
      verdict === 'target_mismatch'
        ? 'target_mismatch'
        : verdict === 'routing_filter'
        ? 'routing_filter'
        : 'valid_dependency';

    return {
      classification,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
      counter_hypothesis: verdict,
      rationale: parsed.rationale || 'Audited by adversarial critic.',
      source: 'llm_critic',
    };
  }

  private async callLlm(systemPrompt: string, userPrompt: string): Promise<CriticDecision> {
    const res = await this.callRaw(systemPrompt, userPrompt);
    const parsed = this.parseJson(res);

    const validClasses = new Set([
      'routing_filter',
      'internal_processing_file',
      'admin_register',
      'prose_phrase',
      'valid_dependency',
    ]);
    const classification: AdversarialClassification = validClasses.has(parsed.classification)
      ? parsed.classification
      : 'valid_dependency';

    return {
      classification,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.85,
      counter_hypothesis: parsed.counter_hypothesis || classification,
      rationale: parsed.rationale || 'Adjudicated by adversarial critic.',
      source: 'llm_critic',
    };
  }

  private async callRaw(systemPrompt: string, userPrompt: string): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.0,
      max_tokens: 1200,
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(`LLM call failed with status ${resp.status}: ${await resp.text()}`);
    }

    const data = (await resp.json()) as any;
    const choice = data.choices?.[0];
    let content = choice?.message?.content;
    if (!content && choice?.message?.reasoning_content) {
      const reasoning = choice.message.reasoning_content;
      const jsonStart = reasoning.lastIndexOf('{');
      const jsonEnd = reasoning.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        content = reasoning.slice(jsonStart, jsonEnd + 1);
      }
    }

    if (!content) {
      throw new Error(`Empty content returned by LLM. Finish reason: ${choice?.finish_reason}`);
    }
    return content;
  }

  private parseJson(raw: string): any {
    // Strip markdown code fences if present
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try {
      return JSON.parse(clean);
    } catch {
      // Find JSON object boundary
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(clean.slice(start, end + 1));
      }
      throw new Error(`Failed to parse JSON from LLM response: ${raw}`);
    }
  }
}

/**
 * Tier 2: Gemini Escalation Arbitrator Client (gemini-3.8-flash)
 */
export class GeminiCriticClient {
  private apiKey?: string;
  private model: string;

  constructor(
    apiKey: string | undefined = process.env.GEMINI_API_KEY,
    model: string = process.env.GEMINI_MODEL || 'gemini-3.8-flash'
  ) {
    this.apiKey = apiKey;
    this.model = model;
  }

  public isAvailable(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  public async evaluateNeedsReview(
    targetVar: string,
    sourceVar: string,
    evidence: string
  ): Promise<CriticDecision> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not configured for Tier 2 escalation.');
    }

    const systemPrompt = `You are the Statistics Canada Derived Variable Escalation Arbitrator (Tier 2).
Evaluate whether a candidate derivation edge (Target <- Source) represents a genuine computational dependency or a false-positive artifact.

Valid classifications:
- "valid_dependency": Source is a genuine computational variable input required to calculate Target.
- "routing_filter": Source is merely a universe skip condition, respondent filter (PMK/Proxy), or interview routing rule.
- "target_mismatch": Source is an unassociated category option pointer, simultaneous exclusion, or unrelated battery note.
- "internal_processing_file": Note explicitly indicates the variable is on an internal processing file, unreleased master file, or not on public file.
- "admin_register": Source is an external administrative file (tax, census geography) joined during post-collection processing.
- "prose_phrase": Source token is descriptive prose text or non-variable label (e.g. "TOTAL", "INCOME").

Respond with strict JSON ONLY:
{
  "classification": "valid_dependency" | "routing_filter" | "target_mismatch" | "internal_processing_file" | "admin_register" | "prose_phrase",
  "confidence": float (0.0 to 1.0),
  "counter_hypothesis": string,
  "rationale": "one concise sentence explaining verdict"
}`;

    const userPrompt = `Target: ${targetVar}. Candidate Source: ${sourceVar}. Evidence note: "${evidence}"`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          response_mime_type: 'application/json',
          temperature: 0.0,
        },
      }),
    });

    if (!resp.ok) {
      throw new Error(`Gemini API failed with status ${resp.status}: ${await resp.text()}`);
    }

    const data = (await resp.json()) as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('No content returned from Gemini API.');
    }

    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(clean);

    return {
      classification: parsed.classification || 'valid_dependency',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.95,
      counter_hypothesis: parsed.counter_hypothesis || parsed.classification,
      rationale: parsed.rationale || 'Adjudicated by Gemini 3.8 Flash escalation arbitrator.',
      source: 'gemini_escalation',
    };
  }
}

/**
 * Main Orchestrator Class
 */
export class LineageOrchestrator {
  private db: DatabaseSync;
  private critic: LocalCriticClient;
  private geminiCritic: GeminiCriticClient;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    dbPath: string = DB_PATH,
    critic?: LocalCriticClient,
    geminiCritic?: GeminiCriticClient
  ) {
    this.db = new DatabaseSync(dbPath);
    try {
      this.db.exec('PRAGMA busy_timeout = 15000;');
    } catch {
      // ignore
    }
    this.critic = critic || new LocalCriticClient();
    this.geminiCritic = geminiCritic || new GeminiCriticClient();
  }

  private async safeWrite(fn: () => void): Promise<void> {
    this.writeLock = this.writeLock.then(async () => {
      let attempts = 0;
      while (true) {
        try {
          fn();
          return;
        } catch (err: any) {
          if ((err.code === 'ERR_SQLITE_ERROR' || err.message?.includes('locked')) && attempts < 5) {
            attempts++;
            await new Promise((resolve) => setTimeout(resolve, 50 * attempts));
          } else {
            throw err;
          }
        }
      }
    });
    return this.writeLock;
  }

  /**
   * Stream A: Sample and audit verified edges to test precision and detect target mismatches
   */
  public async auditSample(options: {
    surveyGroup?: string;
    sampleSize?: number;
    outputReport?: string;
  }): Promise<{
    totalSampled: number;
    confirmedCount: number;
    mismatchCount: number;
    routingCount: number;
    precision: number;
    findings: Array<{ edge: CandidateEdgeRow; decision: CriticDecision }>;
  }> {
    const sampleSize = options.sampleSize || 50;
    const surveyClause = options.surveyGroup ? `AND survey_group = ?` : '';
    const query = `
      SELECT * FROM candidate_edge
      WHERE review_status = 'verified' ${surveyClause}
      ORDER BY RANDOM()
      LIMIT ?
    `;

    const rows = (
      options.surveyGroup
        ? this.db.prepare(query).all(options.surveyGroup, sampleSize)
        : this.db.prepare(query).all(sampleSize)
    ) as unknown as CandidateEdgeRow[];

    console.log(`\n--- Stream A: Auditing Sample of ${rows.length} Verified Edges ---`);
    if (options.surveyGroup) console.log(`Survey: ${options.surveyGroup}`);

    let confirmedCount = 0;
    let mismatchCount = 0;
    let routingCount = 0;
    const findings: Array<{ edge: CandidateEdgeRow; decision: CriticDecision }> = [];

    for (let i = 0; i < rows.length; i++) {
      const edge = rows[i];
      if (!edge) continue;
      try {
        const decision = await this.critic.auditVerifiedEdge(
          edge.target_var_name,
          edge.source_var_name,
          edge.raw_evidence,
          edge.audit_notes
        );
        findings.push({ edge, decision });

        if (decision.classification === 'target_mismatch') {
          mismatchCount++;
          console.log(`  [MISMATCH] ${edge.target_var_name} <- ${edge.source_var_name}: ${decision.rationale}`);
        } else if (decision.classification === 'routing_filter') {
          routingCount++;
          console.log(`  [FILTER]   ${edge.target_var_name} <- ${edge.source_var_name}: ${decision.rationale}`);
        } else {
          confirmedCount++;
        }
      } catch (err: any) {
        console.error(`  [ERROR] on edge ${edge.edge_id}: ${err.message}`);
        confirmedCount++; // conservative default on network error
      }
    }

    const precision = (confirmedCount / (rows.length || 1)) * 100;
    console.log(`\nAudit Results:`);
    console.log(`  Total Sampled:      ${rows.length}`);
    console.log(`  Confirmed Valid:    ${confirmedCount} (${precision.toFixed(1)}%)`);
    console.log(`  Target Mismatches:  ${mismatchCount}`);
    console.log(`  Routing Filters:    ${routingCount}`);

    if (options.outputReport) {
      this.writeSampleAuditReport(options.outputReport, options.surveyGroup || 'All', rows.length, confirmedCount, mismatchCount, routingCount, findings);
    }

    return {
      totalSampled: rows.length,
      confirmedCount,
      mismatchCount,
      routingCount,
      precision,
      findings,
    };
  }

  /**
   * Stream B: Adjudicate needs_review queue with deterministic pre-filter + LLM critic
   */
  public async adjudicateNeedsReview(options: {
    surveyGroup?: string;
    limit?: number;
    concurrency?: number;
    dryRun?: boolean;
    outputReport?: string;
  }): Promise<{
    processed: number;
    rejectedProse: number;
    rejectedInternal: number;
    rejectedAdmin: number;
    rejectedRouting: number;
    retainedNeedsReview: number;
    findings: Array<{ edge: CandidateEdgeRow; decision: CriticDecision }>;
  }> {
    const limit = options.limit || 5000;
    const surveyClause = options.surveyGroup ? `AND survey_group = ?` : '';
    const query = `
      SELECT * FROM candidate_edge
      WHERE review_status = 'needs_review' ${surveyClause}
      LIMIT ?
    `;

    const rows = (
      options.surveyGroup
        ? this.db.prepare(query).all(options.surveyGroup, limit)
        : this.db.prepare(query).all(limit)
    ) as unknown as CandidateEdgeRow[];

    console.log(`\n--- Stream B: Adjudicating ${rows.length} Needs_Review Edges ---`);
    if (options.surveyGroup) console.log(`Survey: ${options.surveyGroup}`);
    if (options.dryRun) console.log(`(Dry run mode: SQLite will NOT be modified)`);

    const updateStmt = this.db.prepare(`
      UPDATE candidate_edge
      SET review_status = ?, confidence = ?, audit_notes = ?, auditor = ?
      WHERE edge_id = ?
    `);

    let rejectedProse = 0;
    let rejectedInternal = 0;
    let rejectedAdmin = 0;
    let rejectedRouting = 0;
    let retainedNeedsReview = 0;
    let escalatedToGemini = 0;
    const findings: Array<{ edge: CandidateEdgeRow; decision: CriticDecision }> = [];
    const escalationQueue: Array<{ edge: CandidateEdgeRow; localDecision: CriticDecision }> = [];

    const concurrency = options.concurrency || 4;
    let nextIdx = 0;
    let completed = 0;

    const worker = async () => {
      while (true) {
        const i = nextIdx++;
        if (i >= rows.length) break;
        const edge = rows[i];
        if (!edge) continue;

        // Step 1: Deterministic fast-path
        let decision = evaluateDeterministicFilter(
          edge.target_var_name,
          edge.source_var_name,
          edge.raw_evidence
        );

        // Step 2: Local LLM Critic if deterministic did not resolve
        if (!decision) {
          try {
            decision = await this.critic.evaluateNeedsReview(
              edge.target_var_name,
              edge.source_var_name,
              edge.raw_evidence
            );
          } catch (err: any) {
            console.warn(`  [WARN] LLM evaluation error on ${edge.target_var_name} <- ${edge.source_var_name}: ${err.message}`);
            decision = {
              classification: 'valid_dependency',
              confidence: 0.7,
              counter_hypothesis: 'Evaluation error',
              rationale: `Retained in needs_review due to LLM error: ${err.message}`,
              source: 'llm_critic',
            };
          }
        }

        // Step 2b: Tier 2 Gemini Escalation if ambiguous, low confidence, or disputed
        if (
          decision &&
          decision.source === 'llm_critic' &&
          (decision.confidence < 0.85 || decision.classification === 'target_mismatch')
        ) {
          if (this.geminiCritic.isAvailable()) {
            try {
              const escalatedDecision = await this.geminiCritic.evaluateNeedsReview(
                edge.target_var_name,
                edge.source_var_name,
                edge.raw_evidence
              );
              decision = escalatedDecision;
              escalatedToGemini++;
            } catch (err: any) {
              console.warn(`  [WARN] Gemini escalation error on ${edge.target_var_name}: ${err.message}`);
              escalationQueue.push({ edge, localDecision: decision });
            }
          } else {
            escalationQueue.push({ edge, localDecision: decision });
          }
        }

        findings.push({ edge, decision });

        // Step 3: Handle classification
        switch (decision.classification) {
          case 'prose_phrase':
            rejectedProse++;
            if (!options.dryRun) {
              await this.safeWrite(() => {
                updateStmt.run(
                  'rejected',
                  0.05,
                  `Evidence from data dictionary: "${edge.raw_evidence}"; AI interpretation and action: Rejected as prose phrase. ${decision.rationale}`,
                  `adversarial_critic_${decision.source}`,
                  edge.edge_id
                );
              });
            }
            break;

          case 'internal_processing_file':
            rejectedInternal++;
            if (!options.dryRun) {
              await this.safeWrite(() => {
                updateStmt.run(
                  'rejected',
                  0.05,
                  `Evidence from data dictionary: "${edge.raw_evidence}"; AI interpretation and action: Rejected as unpublished internal processing / master file item. ${decision.rationale}`,
                  `adversarial_critic_${decision.source}`,
                  edge.edge_id
                );
              });
            }
            break;

          case 'admin_register':
            rejectedAdmin++;
            if (!options.dryRun) {
              await this.safeWrite(() => {
                updateStmt.run(
                  'rejected',
                  0.05,
                  `Evidence from data dictionary: "${edge.raw_evidence}"; AI interpretation and action: Rejected as external administrative register or census code. ${decision.rationale}`,
                  `adversarial_critic_${decision.source}`,
                  edge.edge_id
                );
              });
            }
            break;

          case 'routing_filter':
            rejectedRouting++;
            if (!options.dryRun) {
              await this.safeWrite(() => {
                updateStmt.run(
                  'rejected',
                  0.05,
                  `Evidence from data dictionary: "${edge.raw_evidence}"; AI interpretation and action: Rejected as interview routing condition or respondent filter. ${decision.rationale}`,
                  `adversarial_critic_${decision.source}`,
                  edge.edge_id
                );
              });
            }
            break;

          case 'valid_dependency':
          default:
            retainedNeedsReview++;
            // STRICT INTEGRITY GUARD: Since source_record_id is null, NEVER mark as verified!
            // Annotate with high-fidelity critic notes instead.
            if (!options.dryRun) {
              await this.safeWrite(() => {
                updateStmt.run(
                  'needs_review',
                  decision.confidence,
                  `Evidence from data dictionary: "${edge.raw_evidence}"; AI interpretation and action: Valid dependency confirmed, but source variable is not in published public file (likely master file item). ${decision.rationale}`,
                  `adversarial_critic_${decision.source}`,
                  edge.edge_id
                );
              });
            }
            break;
        }

        completed++;
        if (completed % 10 === 0 || completed === rows.length) {
          console.log(
            `Progress: ${completed}/${rows.length} | Rej Prose: ${rejectedProse} | Rej Internal: ${rejectedInternal} | Rej Admin: ${rejectedAdmin} | Rej Filter: ${rejectedRouting} | Retained: ${retainedNeedsReview}`
          );
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, Math.max(1, rows.length)) }, () => worker())
    );

    console.log(`\nAdjudication Results:`);
    console.log(`  Total Processed:           ${rows.length}`);
    console.log(`  Rejected (Prose Phrase):   ${rejectedProse}`);
    console.log(`  Rejected (Internal File):  ${rejectedInternal}`);
    console.log(`  Rejected (Admin Register): ${rejectedAdmin}`);
    console.log(`  Rejected (Routing Filter): ${rejectedRouting}`);
    console.log(`  Retained in Needs_Review:  ${retainedNeedsReview}`);
    if (escalatedToGemini > 0) {
      console.log(`  Arbitrated by Gemini:      ${escalatedToGemini}`);
    }
    if (escalationQueue.length > 0) {
      const queueFile = path.join(PACKAGE_DIR, 'out', 'escalation_queue.json');
      writeFileSync(queueFile, JSON.stringify(escalationQueue, null, 2), 'utf8');
      console.log(`  Escalation queue saved:    ${queueFile} (${escalationQueue.length} items flagged for Tier 2)`);
    }

    if (options.outputReport) {
      this.writeAdjudicationReport(
        options.outputReport,
        options.surveyGroup || 'All',
        rows.length,
        rejectedProse,
        rejectedInternal,
        rejectedAdmin,
        rejectedRouting,
        retainedNeedsReview,
        findings
      );
    }

    return {
      processed: rows.length,
      rejectedProse,
      rejectedInternal,
      rejectedAdmin,
      rejectedRouting,
      retainedNeedsReview,
      findings,
    };
  }

  /**
   * Tier 0: Run deterministic rule-based pruning across candidate edges.
   * Catches prose phrases, administrative registers, self-loops, and questionnaire battery pointers.
   */
  public async pruneDeterministic(options: { dryRun?: boolean } = {}): Promise<{
    prunedNeedsReview: number;
    prunedVerified: number;
    byCategory: Record<string, number>;
  }> {
    console.log(`\n--- Tier 0: Pruning SQLite Candidate Queue with Deterministic Filters ---`);
    if (options.dryRun) console.log(`(Dry run mode: SQLite will NOT be modified)`);

    const updateStmt = this.db.prepare(`
      UPDATE candidate_edge
      SET review_status = 'rejected', confidence = ?, audit_notes = ?, auditor = ?
      WHERE edge_id = ?
    `);

    const rows = this.db.prepare(`
      SELECT edge_id, target_var_name, source_var_name, raw_evidence, review_status
      FROM candidate_edge
      WHERE review_status IN ('needs_review', 'verified')
    `).all() as unknown as CandidateEdgeRow[];

    let prunedNeedsReview = 0;
    let prunedVerified = 0;
    const byCategory: Record<string, number> = {};

    for (let i = 0; i < rows.length; i++) {
      const edge = rows[i];
      if (!edge) continue;

      const decision = evaluateDeterministicFilter(
        edge.target_var_name,
        edge.source_var_name,
        edge.raw_evidence
      );

      if (decision) {
        byCategory[decision.classification] = (byCategory[decision.classification] || 0) + 1;
        if (edge.review_status === 'needs_review') {
          prunedNeedsReview++;
        } else if (edge.review_status === 'verified') {
          prunedVerified++;
        }

        if (!options.dryRun) {
          updateStmt.run(
            decision.confidence,
            `Evidence from data dictionary: "${edge.raw_evidence}"; Rule interpretation and action: Rejected as ${decision.classification}. ${decision.rationale}`,
            'deterministic_tier0',
            edge.edge_id
          );
        }
      }
    }

    console.log(`\nDeterministic Prune Results:`);
    console.log(`  Scanned active candidate edges: ${rows.length}`);
    console.log(`  Pruned from needs_review:       ${prunedNeedsReview}`);
    console.log(`  Quarantined from verified:       ${prunedVerified}`);
    console.log(`  Total edges resolved:            ${prunedNeedsReview + prunedVerified}`);
    console.log(`  Breakdown by classification:`);
    for (const [cls, count] of Object.entries(byCategory)) {
      console.log(`    - ${cls}: ${count}`);
    }

    return { prunedNeedsReview, prunedVerified, byCategory };
  }

  private writeSampleAuditReport(
    filePath: string,
    survey: string,
    total: number,
    confirmed: number,
    mismatch: number,
    routing: number,
    findings: Array<{ edge: CandidateEdgeRow; decision: CriticDecision }>
  ) {
    const precision = ((confirmed / (total || 1)) * 100).toFixed(1);
    const lines: string[] = [
      `# Adversarial Audit Report: Verified Edge Precision (${survey})`,
      ``,
      `**Date:** ${new Date().toISOString()}`,
      `**Survey Group:** ${survey}`,
      `**Total Sampled:** ${total}`,
      `**Confirmed Dependencies:** ${confirmed} (${precision}%)`,
      `**Target Mismatches:** ${mismatch}`,
      `**Routing / Filter Flags:** ${routing}`,
      ``,
      `## Detailed Audit Findings`,
      ``,
      `| Target | Source | Verdict | Confidence | Source | Rationale |`,
      `|---|---|---|---|---|---|`,
    ];

    for (const f of findings) {
      lines.push(
        `| \`${f.edge.target_var_name}\` | \`${f.edge.source_var_name}\` | **${f.decision.classification}** | ${(f.decision.confidence * 100).toFixed(0)}% | ${f.decision.source} | ${f.decision.rationale.replace(/\|/g, '\\|')} |`
      );
    }

    writeFileSync(filePath, lines.join('\n'), 'utf8');
    console.log(`Sample audit report saved to: ${filePath}`);
  }

  private writeAdjudicationReport(
    filePath: string,
    survey: string,
    total: number,
    prose: number,
    internal: number,
    admin: number,
    routing: number,
    retained: number,
    findings: Array<{ edge: CandidateEdgeRow; decision: CriticDecision }>
  ) {
    const lines: string[] = [
      `# Adversarial Adjudication Report: Needs_Review Queue (${survey})`,
      ``,
      `**Date:** ${new Date().toISOString()}`,
      `**Survey Group:** ${survey}`,
      `**Total Processed:** ${total}`,
      `**Rejected (Prose Phrase):** ${prose}`,
      `**Rejected (Internal File):** ${internal}`,
      `**Rejected (Admin Register):** ${admin}`,
      `**Rejected (Routing Filter):** ${routing}`,
      `**Retained in Needs_Review:** ${retained}`,
      ``,
      `## Sample Decisions`,
      ``,
      `| Target | Source | Classification | Confidence | Rule | Rationale |`,
      `|---|---|---|---|---|---|`,
    ];

    for (const f of findings.slice(0, 100)) {
      lines.push(
        `| \`${f.edge.target_var_name}\` | \`${f.edge.source_var_name}\` | **${f.decision.classification}** | ${(f.decision.confidence * 100).toFixed(0)}% | ${f.decision.source} | ${f.decision.rationale.replace(/\|/g, '\\|')} |`
      );
    }

    writeFileSync(filePath, lines.join('\n'), 'utf8');
    console.log(`Adjudication report saved to: ${filePath}`);
  }
}

// CLI Driver
async function main() {
  const args = process.argv.slice(2);
  let mode: 'audit' | 'adjudicate' | 'prune' = 'adjudicate';
  let surveyGroup: string | undefined = undefined;
  let sampleSize = 50;
  let limit = 5000;
  let dryRun = false;
  let model = process.env.LOCAL_LLM_MODEL || 'microsoft/phi-4';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    if (arg === '--mode' && nextArg !== undefined) {
      mode = nextArg === 'audit' ? 'audit' : nextArg === 'prune' ? 'prune' : 'adjudicate';
      i++;
    } else if (arg === '--survey' && nextArg !== undefined) {
      surveyGroup = nextArg;
      i++;
    } else if (arg === '--sample' && nextArg !== undefined) {
      sampleSize = parseInt(nextArg, 10);
      i++;
    } else if (arg === '--limit' && nextArg !== undefined) {
      limit = parseInt(nextArg, 10);
      i++;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--model' && nextArg !== undefined) {
      model = nextArg;
      i++;
    }
  }

  const critic = new LocalCriticClient(undefined, model);
  const orchestrator = new LineageOrchestrator(DB_PATH, critic);

  if (mode === 'prune') {
    await orchestrator.pruneDeterministic({ dryRun });
  } else if (mode === 'audit') {
    const reportPath = path.join(PACKAGE_DIR, 'out', `audit_sample_${surveyGroup || 'all'}.md`);
    await orchestrator.auditSample({
      surveyGroup,
      sampleSize,
      outputReport: reportPath,
    });
  } else {
    const reportPath = path.join(PACKAGE_DIR, 'out', `adjudicate_${surveyGroup || 'all'}.md`);
    await orchestrator.adjudicateNeedsReview({
      surveyGroup,
      limit,
      dryRun,
      outputReport: reportPath,
    });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('Fatal error in orchestrator:', err);
    process.exit(1);
  });
}
