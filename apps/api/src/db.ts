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
    `);
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

  // ── Seed ────────────────────────────────────────────────────────────────────

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
}
