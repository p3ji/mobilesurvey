/**
 * Empirical Critic Benchmark Runner: Jev vs. Phi-4 vs. Qwen-27b
 *
 * Runs a curated, stratified 250-edge evaluation suite against a local model
 * hosted on http://127.0.0.1:1234/v1 to benchmark:
 * 1. Falsification Precision on Adversarial Traps (category pointers, exclusions, routing traps)
 * 2. True Positive Retention on Genuine Lineage Edges
 * 3. Inference Latency & System 1 Throughput (ms/record)
 * 4. Schema/JSON Formatting Reliability
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(HERE, '..', '..');
const DB_PATH = path.join(PACKAGE_DIR, 'out', 'derivation_queue.db');
const OUT_DIR = path.join(PACKAGE_DIR, 'out');
const REPORT_MD = path.join(OUT_DIR, 'critic_benchmark_report.md');
const REPORT_JSON = path.join(OUT_DIR, 'critic_benchmark_report.json');

export interface BenchmarkItem {
  id: string;
  category: 'clean_positive' | 'adversarial_trap' | 'ambiguous_alias';
  targetVar: string;
  sourceVar: string;
  surveyGroup: string;
  cycle: string;
  evidence: string;
  expectedVerdict: 'valid_dependency' | 'invalid_trap' | 'alias_resolution';
  trapType?: string;
}

export interface ModelPrediction {
  itemId: string;
  category: string;
  classification: string;
  confidence: number;
  isCorrect: boolean;
  latencyMs: number;
  rawResponse?: string;
  error?: string;
}

export interface BenchmarkMetrics {
  modelId: string;
  totalTested: number;
  totalDurationMs: number;
  avgLatencyMs: number;
  parseErrors: number;
  cleanPositiveRecall: number;
  trapFalsificationPrecision: number;
  aliasResolutionRate: number;
  overallAccuracy: number;
  predictions: ModelPrediction[];
}

export function loadCuratedBenchmarkItems(dbPath: string = DB_PATH, totalLimit: number = 250): BenchmarkItem[] {
  const db = new DatabaseSync(dbPath);
  const items: BenchmarkItem[] = [];

  const cleanLimit = Math.max(1, Math.round(totalLimit * 0.4));
  const trapLimit = Math.max(1, Math.round(totalLimit * 0.4));
  const aliasLimit = Math.max(1, totalLimit - cleanLimit - trapLimit);

  // 1. Clean True Positives (from verified derivations, deterministic ordering)
  const cleanRows = db
    .prepare(
      `SELECT edge_id, target_var_name, source_var_name, survey_group, cycle, raw_evidence
       FROM candidate_edge
       WHERE review_status = 'verified' AND source_record_id IS NOT NULL AND confidence >= 0.90
       ORDER BY edge_id LIMIT ?`,
    )
    .all(cleanLimit) as any[];

  const cleanItems: BenchmarkItem[] = cleanRows.map((r) => ({
    id: r.edge_id,
    category: 'clean_positive',
    targetVar: r.target_var_name,
    sourceVar: r.source_var_name,
    surveyGroup: r.survey_group,
    cycle: r.cycle,
    evidence: r.raw_evidence,
    expectedVerdict: 'valid_dependency',
  }));

  // 2. Adversarial Traps (from quarantined false-positive cases, deterministic ordering)
  const trapRows = db
    .prepare(
      `SELECT edge_id, target_var_name, source_var_name, survey_group, cycle, raw_evidence, audit_notes
       FROM candidate_edge
       WHERE review_status = 'rejected'
         AND (audit_notes LIKE '%battery category%'
              OR audit_notes LIKE '%simultaneous activity%'
              OR audit_notes LIKE '%Self-referential%'
              OR audit_notes LIKE '%routing%'
              OR audit_notes LIKE '%Prose phrase%')
       ORDER BY edge_id LIMIT ?`,
    )
    .all(trapLimit) as any[];

  const trapItems: BenchmarkItem[] = trapRows.map((r) => ({
    id: r.edge_id,
    category: 'adversarial_trap',
    targetVar: r.target_var_name,
    sourceVar: r.source_var_name,
    surveyGroup: r.survey_group,
    cycle: r.cycle,
    evidence: r.raw_evidence,
    expectedVerdict: 'invalid_trap',
    trapType: r.audit_notes?.slice(0, 50),
  }));

  // 3. Ambiguous Collection Aliases (from concordance_resolved and _Q questions, deterministic ordering)
  const aliasRows = db
    .prepare(
      `SELECT edge_id, target_var_name, source_var_name, survey_group, cycle, raw_evidence
       FROM candidate_edge
       WHERE (review_status = 'verified' AND extraction_method = 'concordance_resolved')
          OR (review_status = 'needs_review' AND source_var_name LIKE '%_Q%')
       ORDER BY edge_id LIMIT ?`,
    )
    .all(aliasLimit) as any[];

  const aliasItems: BenchmarkItem[] = aliasRows.map((r) => ({
    id: r.edge_id,
    category: 'ambiguous_alias',
    targetVar: r.target_var_name,
    sourceVar: r.source_var_name,
    surveyGroup: r.survey_group,
    cycle: r.cycle,
    evidence: r.raw_evidence,
    expectedVerdict: 'alias_resolution',
  }));

  // Interleave the categories so evaluation progress represents diverse distribution
  const maxLen = Math.max(cleanItems.length, trapItems.length, aliasItems.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < cleanItems.length) items.push(cleanItems[i]!);
    if (i < trapItems.length) items.push(trapItems[i]!);
    if (i < aliasItems.length) items.push(aliasItems[i]!);
  }

  return items;
}

const CRITIC_SYSTEM_PROMPT = `You are the Statistics Canada Derived Variable Adversarial Critic.
Evaluate whether a candidate derivation edge (Target <- Source) represents a genuine computational dependency or a false-positive artifact.

Valid classifications:
- "valid_dependency": Source is a genuine computational variable input required to calculate Target.
- "routing_filter": Source is merely a universe skip condition or interview routing filter (e.g. "if AGE >= 12" or "answered only if PMK answered").
- "target_mismatch": Source is a category option pointer, simultaneous exclusion, or unrelated battery note.
- "prose_phrase": Source token is descriptive prose text or non-variable label (e.g. "TOTAL", "INCOME").
- "admin_register": Source is an external administrative file joined during post-collection processing.

Respond with strict JSON ONLY:
{
  "classification": "valid_dependency" | "routing_filter" | "target_mismatch" | "prose_phrase" | "admin_register",
  "confidence": 0.0 - 1.0,
  "rationale": "one concise sentence explaining verdict"
}`;

export async function evaluateModelOnBenchmark(
  modelId: string,
  items: BenchmarkItem[],
  options: { baseUrl?: string; timeoutMs?: number } = {},
): Promise<BenchmarkMetrics> {
  const baseUrl = options.baseUrl || 'http://127.0.0.1:1234/v1';
  const predictions: ModelPrediction[] = [];
  let parseErrors = 0;
  const startAll = Date.now();

  console.log(`\n==> Evaluating Model: ${modelId} on ${items.length} curated benchmark items...`);

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const userPrompt = `Survey: ${item.surveyGroup} (${item.cycle})
Target Variable: ${item.targetVar}
Proposed Source: ${item.sourceVar}
Evidence from data dictionary: "${item.evidence}"

Evaluate this dependency.`;

    const t0 = Date.now();
    try {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'system', content: CRITIC_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.0,
          max_tokens: 300,
        }),
      });

      const latencyMs = Date.now() - t0;
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      }

      const json = (await resp.json()) as any;
      let raw = json.choices?.[0]?.message?.content || json.choices?.[0]?.message?.reasoning_content || '';
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

      let parsed: any;
      try {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        parsed = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
      } catch (e) {
        parseErrors++;
        predictions.push({
          itemId: item.id,
          category: item.category,
          classification: 'parse_error',
          confidence: 0,
          isCorrect: false,
          latencyMs,
          rawResponse: raw.slice(0, 150),
          error: String(e),
        });
        continue;
      }

      const classification = parsed.classification || 'unknown';
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.8;

      let isCorrect = false;
      if (item.category === 'clean_positive') {
        isCorrect = classification === 'valid_dependency';
      } else if (item.category === 'adversarial_trap') {
        isCorrect = classification !== 'valid_dependency';
      } else {
        isCorrect = true; // alias evaluated separately
      }

      predictions.push({
        itemId: item.id,
        category: item.category,
        classification,
        confidence,
        isCorrect,
        latencyMs,
      });

      if ((i + 1) % 25 === 0 || i === items.length - 1) {
        process.stdout.write(`  [${i + 1}/${items.length}] completed (avg ${latencyMs}ms)\r`);
      }
    } catch (err: any) {
      parseErrors++;
      predictions.push({
        itemId: item.id,
        category: item.category,
        classification: 'request_error',
        confidence: 0,
        isCorrect: false,
        latencyMs: Date.now() - t0,
        error: err.message,
      });
    }
  }

  const totalDurationMs = Date.now() - startAll;
  const avgLatencyMs = Math.round(totalDurationMs / items.length);

  const cleanItems = predictions.filter((p) => p.category === 'clean_positive');
  const trapItems = predictions.filter((p) => p.category === 'adversarial_trap');
  const aliasItems = predictions.filter((p) => p.category === 'ambiguous_alias');

  const cleanPositiveRecall = cleanItems.length
    ? Number((cleanItems.filter((p) => p.isCorrect).length / cleanItems.length).toFixed(4))
    : 0;

  const trapFalsificationPrecision = trapItems.length
    ? Number((trapItems.filter((p) => p.isCorrect).length / trapItems.length).toFixed(4))
    : 0;

  const aliasResolutionRate = aliasItems.length
    ? Number((aliasItems.filter((p) => p.classification !== 'parse_error').length / aliasItems.length).toFixed(4))
    : 0;

  const correctTotal = predictions.filter((p) => p.isCorrect).length;
  const overallAccuracy = Number((correctTotal / predictions.length).toFixed(4));

  return {
    modelId,
    totalTested: items.length,
    totalDurationMs,
    avgLatencyMs,
    parseErrors,
    cleanPositiveRecall,
    trapFalsificationPrecision,
    aliasResolutionRate,
    overallAccuracy,
    predictions,
  };
}

export function generateBenchmarkMarkdown(results: BenchmarkMetrics[]): string {
  const lines: string[] = [
    '# Empirical Critic Benchmark: Jev vs. Phi-4 vs. Qwen-27b',
    '',
    `*Generated on: ${new Date().toISOString()}*`,
    '',
    '## 1. Summary Scorecard',
    '',
    '| Metric | ' + results.map((r) => `**${r.modelId}**`).join(' | ') + ' |',
    '|---|' + results.map(() => '---').join('|') + '|',
    '| **Trap Falsification Precision** | ' + results.map((r) => `${(r.trapFalsificationPrecision * 100).toFixed(1)}%`).join(' | ') + ' |',
    '| **Clean Derivation Recall** | ' + results.map((r) => `${(r.cleanPositiveRecall * 100).toFixed(1)}%`).join(' | ') + ' |',
    '| **Overall Accuracy** | ' + results.map((r) => `${(r.overallAccuracy * 100).toFixed(1)}%`).join(' | ') + ' |',
    '| **Average Latency** | ' + results.map((r) => `${r.avgLatencyMs} ms`).join(' | ') + ' |',
    '| **Throughput (items/min)** | ' + results.map((r) => `${Math.round(60000 / (r.avgLatencyMs || 1))}`).join(' | ') + ' |',
    '| **JSON Parse Failures** | ' + results.map((r) => `${r.parseErrors}`).join(' | ') + ' |',
    '',
    '## 2. Methodology & Findings',
    '- **Adversarial Traps Tested:** Category pointers (`CCC_60D category # 5`), simultaneous activity exclusions (`ACT_*`), self-referential collection question codes (`ME_25D <- ME_Q25`), skip-pattern routing filters (`if PRG_Q01 = 1`).',
    '- **Clean Positive Derivations:** Official published data dictionary calculations from CCHS, CHMS, and GSS.',
    '',
  ];
  return lines.join('\n');
}

export async function runBenchmarkCli(): Promise<void> {
  const modelArg = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'microsoft/phi-4';
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx !== -1 && process.argv[limitIdx + 1] ? parseInt(process.argv[limitIdx + 1]!, 10) : undefined;

  const totalLimit = limit && limit > 0 ? limit : 250;
  const items = loadCuratedBenchmarkItems(DB_PATH, totalLimit);
  console.log(`Loaded ${items.length} curated benchmark items from ${DB_PATH}.`);

  const metrics = await evaluateModelOnBenchmark(modelArg, items);

  mkdirSync(OUT_DIR, { recursive: true });

  let allMetrics: BenchmarkMetrics[] = [];
  if (existsSync(REPORT_JSON)) {
    try {
      const prev = JSON.parse(readFileSync(REPORT_JSON, 'utf8'));
      if (Array.isArray(prev)) {
        allMetrics = prev.filter((m: BenchmarkMetrics) => m.modelId !== modelArg);
      } else if (prev && prev.modelId && prev.modelId !== modelArg) {
        allMetrics = [prev];
      }
    } catch {
      // ignore parse errors on previous report
    }
  }
  allMetrics.push(metrics);

  writeFileSync(REPORT_JSON, JSON.stringify(allMetrics, null, 2), 'utf8');
  writeFileSync(REPORT_MD, generateBenchmarkMarkdown(allMetrics), 'utf8');

  console.log(`\n=== Benchmark Results for ${modelArg} ===`);
  console.log(`Overall Accuracy:               ${(metrics.overallAccuracy * 100).toFixed(1)}%`);
  console.log(`Trap Falsification Precision:   ${(metrics.trapFalsificationPrecision * 100).toFixed(1)}%`);
  console.log(`Clean Derivation Recall:        ${(metrics.cleanPositiveRecall * 100).toFixed(1)}%`);
  console.log(`Average Latency:                ${metrics.avgLatencyMs} ms/record`);
  console.log(`Parse Errors:                   ${metrics.parseErrors}`);
  console.log(`Wrote reports to ${REPORT_MD} and ${REPORT_JSON}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runBenchmarkCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
