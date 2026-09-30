/**
 * Durable Local LLM Extraction Queue for StatCan Variable Derivations
 *
 * Implements the consensus design from docs/METADATA_ARCHITECTURE_PLAN.md:
 * - SQLite in Write-Ahead Logging (WAL) mode for atomic, crash-resilient job leasing
 * - Dispatches single or small-batch requests to local Hermes / LM Studio
 * - Uses native JSON Schema enforcement to guarantee deterministic AST parsing
 * - Validates extracted variable names against same-survey same-cycle occurrence index
 * - Stores candidate edges with full provenance
 */

import { DatabaseSync } from 'node:sqlite';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import type { CorpusVariable } from '../types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(HERE, '..', '..');
const CORPUS_JSONL = path.join(PACKAGE_DIR, 'out', 'corpus.jsonl');
const DB_PATH = path.join(PACKAGE_DIR, 'out', 'derivation_queue.db');

export interface ExtractionJob {
  job_id: string;
  record_id: string;
  var_name: string;
  survey_group: string;
  cycle: string;
  raw_note: string;
  status: 'pending' | 'leased' | 'completed' | 'failed' | 'no_formula';
  lease_until: number;
  attempts: number;
  raw_response: string | null;
  candidates: string | null;
  created_at: number;
  updated_at: number;
}

export interface CandidateEdge {
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
}

/**
 * Canonical identity of a lineage edge, independent of which dictionary occurrence
 * minted it. Two data dictionaries for the same survey/cycle (e.g. a PUMF PDF and an
 * RDC PDF) produce different `record_id`s for the same variable name; hashing those
 * into `edge_id` would let one logical edge land several times. Dedupe on names.
 */
export function edgeDedupeKey(edge: {
  survey_group: string;
  cycle: string;
  target_var_name: string;
  source_var_name: string;
  derivation_type: string;
}): string {
  return crypto
    .createHash('sha256')
    .update(
      `${edge.survey_group}:${edge.cycle}:` +
        `${edge.target_var_name.toUpperCase()}:${edge.source_var_name.toUpperCase()}:` +
        `${edge.derivation_type}`
    )
    .digest('hex');
}

/**
 * Idempotent migration: add `dedupe_key`, backfill it, collapse rows that share one
 * (keeping the most-reviewed/highest-confidence survivor), then enforce uniqueness.
 * Safe to call from every process that opens the queue DB.
 */
export function ensureEdgeDedupeSchema(db: DatabaseSync) {
  try {
    db.exec(`ALTER TABLE candidate_edge ADD COLUMN dedupe_key TEXT;`);
  } catch {
    // Column already present
  }

  const pending = db
    .prepare(
      `SELECT edge_id, survey_group, cycle, target_var_name, source_var_name, derivation_type
       FROM candidate_edge WHERE dedupe_key IS NULL`
    )
    .all() as Array<{
    edge_id: string;
    survey_group: string;
    cycle: string;
    target_var_name: string;
    source_var_name: string;
    derivation_type: string;
  }>;
  if (pending.length > 0) {
    const upd = db.prepare(`UPDATE candidate_edge SET dedupe_key = ? WHERE edge_id = ?`);
    for (const r of pending) upd.run(edgeDedupeKey(r), r.edge_id);
  }

  // Collapse duplicates: winner is the most-advanced review status, then highest
  // confidence, then oldest. Rejected rows only survive when they are alone.
  const before = (db.prepare(`SELECT COUNT(*) AS c FROM candidate_edge`).get() as { c: number }).c;
  db.exec(`
    DELETE FROM candidate_edge
    WHERE edge_id NOT IN (
      SELECT edge_id FROM (
        SELECT edge_id, ROW_NUMBER() OVER (
          PARTITION BY dedupe_key
          ORDER BY
            CASE review_status
              WHEN 'verified' THEN 3
              WHEN 'needs_review' THEN 2
              WHEN 'candidate' THEN 1
              ELSE 0
            END DESC,
            confidence DESC,
            created_at ASC,
            edge_id ASC
        ) AS rn
        FROM candidate_edge
      ) WHERE rn = 1
    )
  `);
  const removed = before - (db.prepare(`SELECT COUNT(*) AS c FROM candidate_edge`).get() as { c: number }).c;
  if (removed > 0) console.log(`Dedupe migration: collapsed ${removed} duplicate candidate edges.`);

  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_edge_dedupe ON candidate_edge (dedupe_key);`);
}

export class DerivationQueue {
  private db: DatabaseSync;

  constructor(dbPath: string = DB_PATH) {
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS derivation_job (
        job_id        TEXT PRIMARY KEY,
        record_id     TEXT NOT NULL,
        var_name      TEXT NOT NULL,
        survey_group  TEXT NOT NULL,
        cycle         TEXT NOT NULL,
        raw_note      TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        lease_until   INTEGER DEFAULT 0,
        attempts      INTEGER DEFAULT 0,
        raw_response  TEXT,
        candidates    TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_job_status ON derivation_job (status, lease_until);
      CREATE INDEX IF NOT EXISTS idx_job_record ON derivation_job (record_id);

      CREATE TABLE IF NOT EXISTS candidate_edge (
        edge_id            TEXT PRIMARY KEY,
        target_record_id   TEXT NOT NULL,
        target_var_name    TEXT NOT NULL,
        source_record_id   TEXT,
        source_var_name    TEXT NOT NULL,
        survey_group       TEXT NOT NULL,
        cycle              TEXT NOT NULL,
        derivation_type    TEXT NOT NULL,
        expression_summary TEXT,
        raw_evidence       TEXT NOT NULL,
        extraction_method  TEXT NOT NULL,
        confidence         REAL NOT NULL,
        review_status      TEXT NOT NULL,
        created_at         INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_edge_target ON candidate_edge (target_record_id);
      CREATE INDEX IF NOT EXISTS idx_edge_source ON candidate_edge (source_record_id);
    `);
    ensureEdgeDedupeSchema(this.db);
  }

  public getStats() {
    const totalStmt = this.db.prepare('SELECT count(*) as count FROM derivation_job');
    const statusStmt = this.db.prepare(
      'SELECT status, count(*) as count FROM derivation_job GROUP BY status'
    );
    const edgesStmt = this.db.prepare('SELECT count(*) as count FROM candidate_edge');

    const total = (totalStmt.get() as { count: number }).count;
    const byStatus = (statusStmt.all() as Array<{ status: string; count: number }>).reduce(
      (acc, r) => {
        acc[r.status] = r.count;
        return acc;
      },
      {} as Record<string, number>
    );
    const edges = (edgesStmt.get() as { count: number }).count;

    return { total, byStatus, edges };
  }

  public seedFromCorpus(options: { limit?: number; surveyGroup?: string; lang?: string } = {}) {
    const targetLang = options.lang !== undefined ? options.lang : 'en';
    console.log(`Seeding queue from ${CORPUS_JSONL} (lang filter: ${targetLang || 'all'})...`);
    const rl = createInterface({
      input: createReadStream(CORPUS_JSONL, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO derivation_job (
        job_id, record_id, var_name, survey_group, cycle, raw_note,
        status, lease_until, attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, 0, ?, ?)
    `);

    let scanned = 0;
    let seeded = 0;
    const now = Date.now();

    const PROMPT_VERSION = 'v1';
    const MODEL_ID = process.env.LOCAL_LLM_MODEL || 'qwen3.8-27b';

    return new Promise<number>((resolve) => {
      rl.on('line', (line) => {
        if (!line.trim()) return;
        scanned++;
        const v = JSON.parse(line) as CorpusVariable;

        // Language filter: Default to English only per Supabase free tier constraint
        if (targetLang && v.source?.lang !== targetLang) return;

        // Filter: derived variables or notes indicating derivation
        const note = (v.note || '').trim();
        const isDerivedHint =
          note.toLowerCase().includes('derived from') ||
          note.toLowerCase().includes('calculated from') ||
          note.toLowerCase().includes('based on questions') ||
          v.name.includes('D') || // StatCan convention: D in mnemonic often indicates derived
          v.concept?.toLowerCase().includes('derived') ||
          false;

        if (!note || note.length < 15 || !isDerivedHint) return;

        if (options.surveyGroup && v.source.surveyGroup !== options.surveyGroup) return;

        const noteHash = crypto.createHash('sha256').update(note).digest('hex').slice(0, 16);
        const jobId = crypto
          .createHash('sha256')
          .update(`${v.recordId}:${noteHash}:${PROMPT_VERSION}:${MODEL_ID}`)
          .digest('hex');

        insertStmt.run(
          jobId,
          v.recordId,
          v.name,
          v.source.surveyGroup,
          v.source.cycle || String(v.source.year || ''),
          note,
          now,
          now
        );
        seeded++;

        if (options.limit && seeded >= options.limit) {
          rl.close();
        }
      });

      rl.on('close', () => {
        console.log(`Seeding complete. Scanned ${scanned} variables, queued ${seeded} jobs.`);
        resolve(seeded);
      });
    });
  }

  public leaseJobs(batchSize: number = 2, leaseDurationMs: number = 60000): ExtractionJob[] {
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // 1. Recover expired leases
      const expireStmt = this.db.prepare(`
        UPDATE derivation_job
        SET status = 'pending', lease_until = 0
        WHERE status = 'leased' AND lease_until < ?
      `);
      expireStmt.run(now);

      // 2. Select pending jobs
      const selectStmt = this.db.prepare(`
        SELECT * FROM derivation_job
        WHERE status = 'pending' AND attempts < 3
        ORDER BY created_at ASC
        LIMIT ?
      `);
      const jobs = selectStmt.all(batchSize) as unknown as ExtractionJob[];

      if (jobs.length > 0) {
        const leaseUntil = now + leaseDurationMs;
        const updateStmt = this.db.prepare(`
          UPDATE derivation_job
          SET status = 'leased', lease_until = ?, attempts = attempts + 1, updated_at = ?
          WHERE job_id = ?
        `);
        for (const job of jobs) {
          updateStmt.run(leaseUntil, now, job.job_id);
          job.status = 'leased';
          job.lease_until = leaseUntil;
        }
      }

      this.db.exec('COMMIT');
      return jobs;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public recordJobResult(
    jobId: string,
    result: {
      status: 'completed' | 'no_formula' | 'failed';
      rawResponse?: string;
      candidates?: unknown[];
    }
  ) {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE derivation_job
      SET status = ?, raw_response = ?, candidates = ?, lease_until = 0, updated_at = ?
      WHERE job_id = ?
    `);
    stmt.run(
      result.status,
      result.rawResponse || null,
      result.candidates ? JSON.stringify(result.candidates) : null,
      now,
      jobId
    );
  }

  public saveCandidateEdges(edges: CandidateEdge[]) {
    if (edges.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO candidate_edge (
        edge_id, dedupe_key, target_record_id, target_var_name, source_record_id, source_var_name,
        survey_group, cycle, derivation_type, expression_summary, raw_evidence,
        extraction_method, confidence, review_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const edge of edges) {
      const dedupeKey = edgeDedupeKey(edge);
      const edgeId = crypto
        .createHash('sha256')
        .update(`${dedupeKey}:${edge.target_record_id}`)
        .digest('hex');

      stmt.run(
        edgeId,
        dedupeKey,
        edge.target_record_id,
        edge.target_var_name,
        edge.source_record_id,
        edge.source_var_name,
        edge.survey_group,
        edge.cycle,
        edge.derivation_type,
        edge.expression_summary,
        edge.raw_evidence,
        edge.extraction_method,
        edge.confidence,
        edge.review_status,
        edge.created_at
      );
    }
  }
}

/**
 * Invokes local OpenAI-compatible server (LM Studio / Hermes llama-server)
 */
export async function extractDerivationWithLocalLLM(
  varName: string,
  noteText: string,
  endpoint: string = process.env.LOCAL_LLM_URL || 'http://127.0.0.1:1234/v1',
  model: string = process.env.LOCAL_LLM_MODEL || 'qwen3.8-27b'
): Promise<{
  has_derivation: boolean;
  derivation_type: string;
  source_variables: string[];
  expression_summary: string;
  raw: string;
}> {
  const systemPrompt = `You are a Statistics Canada survey metadata specialist.
Extract computational lineage and variable dependencies from data dictionary documentation notes.
Identify explicitly referenced source question/variable mnemonics (e.g. "GEN_01", "HWTDHTM", "INC_05").`;

  const userPrompt = `Target Variable: ${varName}
Documentation Note:
"""
${noteText}
"""

Extract all source variables and the derivation logic.`;

  const schema = {
    type: 'object',
    properties: {
      has_derivation: {
        type: 'boolean',
        description: 'True if the note describes an explicit derivation, calculation, or recode rule.',
      },
      derivation_type: {
        type: 'string',
        enum: ['formula', 'recode', 'collapse', 'imputation', 'other'],
      },
      source_variables: {
        type: 'array',
        items: { type: 'string' },
        description: 'Exact variable or question names that feed into this calculation.',
      },
      expression_summary: {
        type: 'string',
        description: 'Concise summary of formula or mapping logic.',
      },
    },
    required: ['has_derivation', 'derivation_type', 'source_variables', 'expression_summary'],
    additionalProperties: false,
  };

  const res = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'derivation_extraction',
          strict: true,
          schema,
        },
      },
      temperature: 0.1,
      max_tokens: 1500,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`LLM endpoint error ${res.status}: ${errorText}`);
  }

  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const rawContent = json.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(rawContent);

  return {
    ...parsed,
    raw: rawContent,
  };
}

/**
 * Builds an in-memory lookup index of (surveyGroup:cycle:varName) -> recordId
 * so LLM outputs can be resolved against real dataset columns.
 */
export async function buildOccurrenceLookup(): Promise<Map<string, string>> {
  console.log('Building in-memory survey variable lookup index...');
  const lookup = new Map<string, string>(); // "surveyGroup:cycle:varName" -> recordId

  const rl = createInterface({
    input: createReadStream(CORPUS_JSONL, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const v = JSON.parse(line) as CorpusVariable;
    const cycle = v.source.cycle || String(v.source.year || '');
    const key = `${v.source.surveyGroup}:${cycle}:${v.name.toUpperCase()}`;
    lookup.set(key, v.recordId);
  }

  console.log(`Lookup index built with ${lookup.size} unique keys.`);
  return lookup;
}

// ---------------------------------------------------------------------------------------------
// CLI Runner
// ---------------------------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('queue.ts')) {
  const args = process.argv.slice(2);
  const queue = new DerivationQueue();

  if (args[0] === 'status') {
    const stats = queue.getStats();
    console.log('\n--- Derivation Queue Status ---');
    console.log(`Total Jobs:      ${stats.total}`);
    console.log(`Candidate Edges: ${stats.edges}`);
    console.log('By Status:');
    for (const [st, count] of Object.entries(stats.byStatus)) {
      console.log(`  - ${st.padEnd(14)}: ${count}`);
    }
  } else if (args[0] === 'seed') {
    const limit = args[1] && args[1] !== 'all' ? parseInt(args[1], 10) : undefined;
    const lang = args[2] || 'en'; // default to English per Supabase free-tier constraint
    queue.seedFromCorpus({ limit, lang: lang === 'all' ? undefined : lang }).then(() => {
      const stats = queue.getStats();
      console.log(`Queue now has ${stats.total} total jobs.`);
    });
  } else if (args[0] === 'run') {
    (async () => {
      console.log('Starting Derivation Queue Worker...');
      const lookup = await buildOccurrenceLookup();
      let running = true;

      process.on('SIGINT', () => {
        console.log('\nStopping worker gracefully...');
        running = false;
      });

      let processedCount = 0;

      while (running) {
        const jobs = queue.leaseJobs(2, 60000);
        if (jobs.length === 0) {
          console.log('No pending jobs. Waiting 5s...');
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }

        for (const job of jobs) {
          if (!running) break;
          console.log(`Processing [${job.var_name}] (${job.survey_group} ${job.cycle})...`);
          try {
            const extracted = await extractDerivationWithLocalLLM(job.var_name, job.raw_note);

            if (!extracted.has_derivation || extracted.source_variables.length === 0) {
              queue.recordJobResult(job.job_id, {
                status: 'no_formula',
                rawResponse: extracted.raw,
              });
              console.log(`  -> No derivation formula found.`);
              continue;
            }

            const candidateEdges: CandidateEdge[] = [];
            for (const srcName of extracted.source_variables) {
              const cleanSrc = srcName.trim().toUpperCase();
              const lookupKey = `${job.survey_group}:${job.cycle}:${cleanSrc}`;
              const resolvedRecordId = lookup.get(lookupKey) || null;

              candidateEdges.push({
                target_record_id: job.record_id,
                target_var_name: job.var_name,
                source_record_id: resolvedRecordId,
                source_var_name: cleanSrc,
                survey_group: job.survey_group,
                cycle: job.cycle,
                derivation_type: extracted.derivation_type,
                expression_summary: extracted.expression_summary,
                raw_evidence: job.raw_note,
                extraction_method: `llm_${process.env.LOCAL_LLM_MODEL || 'qwen3.8-27b'}`,
                confidence: resolvedRecordId ? 0.95 : 0.6,
                review_status: 'candidate',
                created_at: Date.now(),
              });
            }

            queue.saveCandidateEdges(candidateEdges);
            queue.recordJobResult(job.job_id, {
              status: 'completed',
              rawResponse: extracted.raw,
              candidates: candidateEdges,
            });

            processedCount++;
            console.log(
              `  -> Extracted ${candidateEdges.length} edges (${candidateEdges.filter((e) => e.source_record_id).length} resolved).`
            );
          } catch (err: unknown) {
            console.error(`  -> Failed on ${job.var_name}:`, (err as Error).message);
            queue.recordJobResult(job.job_id, {
              status: 'failed',
              rawResponse: String((err as Error).message),
            });
          }
        }
      }

      console.log(`Worker stopped. Total processed this session: ${processedCount}.`);
    })();
  } else {
    console.log('Usage:');
    console.log('  tsx src/graph/queue.ts status');
    console.log('  tsx src/graph/queue.ts seed [limit] [lang=en|fr|all]');
    console.log('  tsx src/graph/queue.ts run');
  }
}
