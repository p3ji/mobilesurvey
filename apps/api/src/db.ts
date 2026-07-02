/**
 * SQLite persistence via Node's built-in `node:sqlite` driver (synchronous, better-sqlite3-style
 * API — DatabaseSync.prepare/run/get/all). Chosen over the `better-sqlite3` native addon because
 * it needs no compile toolchain; the API surface is close enough to swap later if desired.
 *
 * Schema:
 *   cases        one row per sample unit (case) with its pre-fill fields and current status
 *   access_codes access code → case id (respondent authentication)
 *   sessions     resumable runtime state, keyed by `${instrumentId}::${caseId}`
 *   paradata     append-only audit trail of respondent behaviour
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface InterviewerRow {
  id: string;
  name: string;
  email: string | null;
}

export type CaseStatus =
  | 'new'
  | 'in_progress'
  | 'complete'
  | 'callback'
  | 'refused'
  | 'non_contact';

export interface CaseDetail extends CaseRow {
  interviewerId: string | null;
  callbackAt: number | null;
  callbackNote: string | null;
  accessCode: string | null;
}

export interface AuditRow {
  id: number;
  ts: number;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  payload: unknown;
}

export interface CaseRow {
  id: string;
  fields: Record<string, unknown>;
  status: string;
}

export interface ParadataRow {
  ts: number;
  type: string;
  payload?: Record<string, unknown>;
}

export type SurveyStatus = 'draft' | 'published';

export interface SurveySummary {
  id: string;
  title: string;
  requiresAccessCode: boolean;
  status: SurveyStatus;
  questionCount: number;
  updatedAt: number;
}

export interface SurveyFull extends SurveySummary {
  instrument: unknown;
}

/** Count question constructs in a parsed instrument (best-effort, for list summaries). */
function countQuestions(instrument: unknown): number {
  let n = 0;
  const visit = (node: { type?: string; children?: unknown[]; then?: unknown[]; else?: unknown[] }) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'question') n += 1;
    for (const arr of [node.children, node.then, node.else]) {
      if (Array.isArray(arr)) for (const c of arr) visit(c as never);
    }
  };
  const seq = (instrument as { sequence?: unknown }).sequence;
  if (seq) visit(seq as never);
  return n;
}

export class Store {
  private db: DatabaseSync;

  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY,
        fields_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new'
      );
      CREATE TABLE IF NOT EXISTS access_codes (
        code TEXT PRIMARY KEY,
        case_id TEXT NOT NULL REFERENCES cases(id)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        key TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS paradata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        actor TEXT NOT NULL DEFAULT 'anon',
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        payload_json TEXT
      );
      CREATE TABLE IF NOT EXISTS surveys (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        instrument_json TEXT NOT NULL,
        requires_access_code INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'draft',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS interviewers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        created_at INTEGER NOT NULL
      );
    `);
    // CATI columns. SQLite has no `ADD COLUMN IF NOT EXISTS`, so probe PRAGMA table_info and
    // alter only what's missing — idempotent for both fresh and pre-Phase-11 databases.
    const caseCols = new Set(
      (this.db.prepare(`PRAGMA table_info(cases)`).all() as { name: string }[]).map((c) => c.name),
    );
    const catiCols: Array<[name: string, type: string]> = [
      ['interviewer_id', 'TEXT'],
      ['callback_at', 'INTEGER'],
      ['callback_note', 'TEXT'],
    ];
    for (const [name, type] of catiCols) {
      if (!caseCols.has(name)) this.db.exec(`ALTER TABLE cases ADD COLUMN ${name} ${type}`);
    }
  }

  // ── Surveys (management hub) ────────────────────────────────────────────────

  private rowToSummary(r: {
    id: string;
    title: string;
    instrument_json: string;
    requires_access_code: number;
    status: string;
    updated_at: number;
  }): SurveySummary {
    return {
      id: r.id,
      title: r.title,
      requiresAccessCode: r.requires_access_code === 1,
      status: r.status as SurveyStatus,
      questionCount: countQuestions(JSON.parse(r.instrument_json)),
      updatedAt: r.updated_at,
    };
  }

  listSurveys(): SurveySummary[] {
    const rows = this.db.prepare(`SELECT * FROM surveys ORDER BY updated_at DESC`).all() as never[];
    return rows.map((r) => this.rowToSummary(r));
  }

  getSurvey(id: string): SurveyFull | null {
    const r = this.db.prepare(`SELECT * FROM surveys WHERE id = ?`).get(id) as
      | {
          id: string;
          title: string;
          instrument_json: string;
          requires_access_code: number;
          status: string;
          updated_at: number;
        }
      | undefined;
    if (!r) return null;
    return { ...this.rowToSummary(r), instrument: JSON.parse(r.instrument_json) };
  }

  createSurvey(input: {
    id?: string;
    title: string;
    instrument: unknown;
    requiresAccessCode?: boolean;
    status?: SurveyStatus;
  }): string {
    const id = input.id ?? `srv_${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO surveys (id, title, instrument_json, requires_access_code, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.title,
        JSON.stringify(input.instrument),
        input.requiresAccessCode === false ? 0 : 1,
        input.status ?? 'draft',
        Date.now(),
      );
    return id;
  }

  updateSurvey(id: string, patch: { title?: string; instrument?: unknown }): boolean {
    const existing = this.getSurvey(id);
    if (!existing) return false;
    this.db
      .prepare(`UPDATE surveys SET title = ?, instrument_json = ?, updated_at = ? WHERE id = ?`)
      .run(
        patch.title ?? existing.title,
        JSON.stringify(patch.instrument ?? existing.instrument),
        Date.now(),
        id,
      );
    return true;
  }

  setSurveyConfig(
    id: string,
    config: { requiresAccessCode?: boolean; status?: SurveyStatus },
  ): boolean {
    const existing = this.getSurvey(id);
    if (!existing) return false;
    const requires =
      config.requiresAccessCode === undefined
        ? existing.requiresAccessCode
        : config.requiresAccessCode;
    this.db
      .prepare(`UPDATE surveys SET requires_access_code = ?, status = ?, updated_at = ? WHERE id = ?`)
      .run(requires ? 1 : 0, config.status ?? existing.status, Date.now(), id);
    return true;
  }

  deleteSurvey(id: string): boolean {
    const r = this.db.prepare(`DELETE FROM surveys WHERE id = ?`).run(id);
    return r.changes > 0;
  }

  /** Seed default surveys if the table is empty (idempotent). */
  seedSurveys(
    defaults: Array<{
      id: string;
      title: string;
      instrument: unknown;
      requiresAccessCode: boolean;
      status: SurveyStatus;
    }>,
  ): void {
    const count = this.db.prepare(`SELECT COUNT(*) AS n FROM surveys`).get() as { n: number };
    if (count.n > 0) return;
    for (const d of defaults) this.createSurvey(d);
  }

  // ── CMS: access codes + cases ───────────────────────────────────────────────

  resolveAccessCode(code: string): CaseRow | null {
    const row = this.db
      .prepare(
        `SELECT c.id AS id, c.fields_json AS fields_json, c.status AS status
         FROM access_codes a JOIN cases c ON c.id = a.case_id
         WHERE a.code = ?`,
      )
      .get(code.trim().toUpperCase()) as
      | { id: string; fields_json: string; status: string }
      | undefined;
    if (!row) return null;
    return { id: row.id, fields: JSON.parse(row.fields_json), status: row.status };
  }

  setCaseStatus(caseId: string, status: string): void {
    this.db.prepare(`UPDATE cases SET status = ? WHERE id = ?`).run(status, caseId);
  }

  getCase(caseId: string): CaseRow | null {
    const row = this.db
      .prepare(`SELECT id, fields_json, status FROM cases WHERE id = ?`)
      .get(caseId) as { id: string; fields_json: string; status: string } | undefined;
    if (!row) return null;
    return { id: row.id, fields: JSON.parse(row.fields_json), status: row.status };
  }

  listCases(): CaseRow[] {
    const rows = this.db.prepare(`SELECT id, fields_json, status FROM cases`).all() as Array<{
      id: string;
      fields_json: string;
      status: string;
    }>;
    return rows.map((r) => ({ id: r.id, fields: JSON.parse(r.fields_json), status: r.status }));
  }

  // ── Sessions (resume) ───────────────────────────────────────────────────────

  loadSession(key: string): unknown | null {
    const row = this.db.prepare(`SELECT state_json FROM sessions WHERE key = ?`).get(key) as
      | { state_json: string }
      | undefined;
    return row ? JSON.parse(row.state_json) : null;
  }

  saveSession(key: string, state: unknown): void {
    this.db
      .prepare(
        `INSERT INTO sessions (key, state_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(state), Date.now());
  }

  clearSession(key: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE key = ?`).run(key);
  }

  // ── Paradata ────────────────────────────────────────────────────────────────

  addParadata(sessionKey: string | null, event: ParadataRow): void {
    this.db
      .prepare(`INSERT INTO paradata (session_key, ts, type, payload_json) VALUES (?, ?, ?, ?)`)
      .run(sessionKey, event.ts, event.type, event.payload ? JSON.stringify(event.payload) : null);
  }

  listParadata(sessionKey: string): ParadataRow[] {
    const rows = this.db
      .prepare(`SELECT ts, type, payload_json FROM paradata WHERE session_key = ? ORDER BY id`)
      .all(sessionKey) as Array<{ ts: number; type: string; payload_json: string | null }>;
    return rows.map((r) => ({
      ts: r.ts,
      type: r.type,
      payload: r.payload_json ? JSON.parse(r.payload_json) : undefined,
    }));
  }

  // ── CATI: interviewers ───────────────────────────────────────────────────────

  listInterviewers(): InterviewerRow[] {
    return (
      this.db.prepare(`SELECT id, name, email FROM interviewers ORDER BY name`).all() as Array<{
        id: string;
        name: string;
        email: string | null;
      }>
    ).map((r) => ({ id: r.id, name: r.name, email: r.email }));
  }

  createInterviewer(id: string, name: string, email?: string): void {
    this.db
      .prepare(`INSERT OR IGNORE INTO interviewers (id, name, email, created_at) VALUES (?, ?, ?, ?)`)
      .run(id, name, email ?? null, Date.now());
  }

  // ── CATI: cases (detailed) ───────────────────────────────────────────────────

  listCasesDetailed(opts?: { interviewerId?: string }): CaseDetail[] {
    const sql = opts?.interviewerId
      ? `SELECT c.id, c.fields_json, c.status, c.interviewer_id, c.callback_at, c.callback_note, a.code
         FROM cases c LEFT JOIN access_codes a ON a.case_id = c.id
         WHERE c.interviewer_id = ? ORDER BY c.id`
      : `SELECT c.id, c.fields_json, c.status, c.interviewer_id, c.callback_at, c.callback_note, a.code
         FROM cases c LEFT JOIN access_codes a ON a.case_id = c.id ORDER BY c.id`;
    type Row = {
      id: string; fields_json: string; status: string; interviewer_id: string | null;
      callback_at: number | null; callback_note: string | null; code: string | null;
    };
    const rows = opts?.interviewerId
      ? (this.db.prepare(sql).all(opts.interviewerId) as Row[])
      : (this.db.prepare(sql).all() as Row[]);
    return rows.map((r) => ({
      id: r.id,
      fields: JSON.parse(r.fields_json),
      status: r.status,
      interviewerId: r.interviewer_id,
      callbackAt: r.callback_at,
      callbackNote: r.callback_note,
      accessCode: r.code,
    }));
  }

  assignCase(caseId: string, interviewerId: string): void {
    this.db
      .prepare(`UPDATE cases SET interviewer_id = ? WHERE id = ?`)
      .run(interviewerId, caseId);
  }

  setCaseOutcome(
    caseId: string,
    status: string,
    callbackAt?: number | null,
    callbackNote?: string | null,
  ): void {
    this.db
      .prepare(`UPDATE cases SET status = ?, callback_at = ?, callback_note = ? WHERE id = ?`)
      .run(status, callbackAt ?? null, callbackNote ?? null, caseId);
  }

  // ── Seed ────────────────────────────────────────────────────────────────────

  // ── Audit log ───────────────────────────────────────────────────────────────

  logAudit(
    action: string,
    entityType: string,
    entityId: string | null,
    payload?: unknown,
    actor = 'anon',
  ): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (ts, actor, action, entity_type, entity_id, payload_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(Date.now(), actor, action, entityType, entityId, payload ? JSON.stringify(payload) : null);
  }

  listAuditLog(opts?: { entityId?: string; limit?: number }): AuditRow[] {
    const limit = opts?.limit ?? 200;
    const rows = opts?.entityId
      ? (this.db
          .prepare(
            `SELECT * FROM audit_log WHERE entity_id = ? ORDER BY ts DESC LIMIT ?`,
          )
          .all(opts.entityId, limit) as Array<{
            id: number; ts: number; actor: string; action: string;
            entity_type: string; entity_id: string | null; payload_json: string | null;
          }>)
      : (this.db
          .prepare(`SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?`)
          .all(limit) as Array<{
            id: number; ts: number; actor: string; action: string;
            entity_type: string; entity_id: string | null; payload_json: string | null;
          }>);
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      actor: r.actor,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      payload: r.payload_json ? JSON.parse(r.payload_json) : null,
    }));
  }

  /** Seed demo cases + access codes if the table is empty (idempotent). */
  seed(): void {
    const count = this.db.prepare(`SELECT COUNT(*) AS n FROM cases`).get() as { n: number };
    if (count.n > 0) return;

    const insertCase = this.db.prepare(
      `INSERT INTO cases (id, fields_json, status) VALUES (?, ?, 'new')`,
    );
    const insertCode = this.db.prepare(`INSERT INTO access_codes (code, case_id) VALUES (?, ?)`);

    const cases: Array<{ id: string; code: string; fields: Record<string, unknown> }> = [
      {
        id: 'case-0001',
        code: 'ABC123',
        fields: { contact_name: 'Jordan Lee', region_code: 'QC', email: 'jordan.lee@example.org' },
      },
      {
        id: 'case-0002',
        code: 'DEF456',
        fields: { contact_name: 'Marie Tremblay', region_code: 'ON', email: 'marie.t@example.org' },
      },
    ];

    for (const c of cases) {
      insertCase.run(c.id, JSON.stringify(c.fields));
      insertCode.run(c.code, c.id);
    }
  }

  /** Seed CATI demo data: 3 interviewers + 4 extra cases with mixed statuses. Idempotent. */
  seedCati(): void {
    const intCount = this.db.prepare(`SELECT COUNT(*) AS n FROM interviewers`).get() as { n: number };
    if (intCount.n === 0) {
      for (const [id, name, email] of [
        ['int-001', 'Alice Nakamura', 'alice@example.org'],
        ['int-002', 'Bob Okonkwo', 'bob@example.org'],
        ['int-003', 'Chen Wei', 'chen@example.org'],
      ] as [string, string, string][]) {
        this.createInterviewer(id, name, email);
      }
    }

    // Assign the original 2 seed cases to interviewers (no-op if already assigned).
    this.db
      .prepare(`UPDATE cases SET interviewer_id = ? WHERE id = ? AND interviewer_id IS NULL`)
      .run('int-001', 'case-0001');
    this.db
      .prepare(`UPDATE cases SET interviewer_id = ? WHERE id = ? AND interviewer_id IS NULL`)
      .run('int-003', 'case-0002');

    const insertCase = this.db.prepare(
      `INSERT OR IGNORE INTO cases (id, fields_json, status, interviewer_id) VALUES (?, ?, ?, ?)`,
    );
    const insertCode = this.db.prepare(
      `INSERT OR IGNORE INTO access_codes (code, case_id) VALUES (?, ?)`,
    );

    const extras: Array<{
      id: string; code: string; status: string; interviewerId: string;
      fields: Record<string, unknown>;
    }> = [
      {
        id: 'case-0003', code: 'GHI789', status: 'complete', interviewerId: 'int-001',
        fields: { contact_name: 'Hiroshi Tanaka', region_code: 'BC', phone: '604-555-0101' },
      },
      {
        id: 'case-0004', code: 'JKL012', status: 'callback', interviewerId: 'int-002',
        fields: { contact_name: 'Sofia Petrova', region_code: 'AB', phone: '403-555-0202' },
      },
      {
        id: 'case-0005', code: 'MNO345', status: 'refused', interviewerId: 'int-002',
        fields: { contact_name: 'Omar Hassan', region_code: 'MB', phone: '204-555-0303' },
      },
      {
        id: 'case-0006', code: 'PQR678', status: 'non_contact', interviewerId: 'int-003',
        fields: { contact_name: 'Emma Williams', region_code: 'NS', phone: '902-555-0404' },
      },
    ];
    for (const c of extras) {
      insertCase.run(c.id, JSON.stringify(c.fields), c.status, c.interviewerId);
      insertCode.run(c.code, c.id);
    }

    // Give case-0004 a callback time (1 week from DB creation, stored as static epoch).
    this.db
      .prepare(
        `UPDATE cases SET callback_at = ?, callback_note = ? WHERE id = ? AND callback_at IS NULL`,
      )
      .run(1751500800000, 'Call back after 6 pm — respondent requested evening slot', 'case-0004');
  }
}
