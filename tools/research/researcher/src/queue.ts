import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chunks, hash, PROMPT_VERSION, type Extraction, type SourceWork, workId } from './model.js';

export interface Job {
  id: string; work_id: string; chunk: string; chunk_index: number; source_json: string;
  status: string; attempts: number; lease_until: number; issues: string | null;
}

export class ResearchQueue {
  readonly db: DatabaseSync;
  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS work (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, doi TEXT, url TEXT NOT NULL,
        year INTEGER, work_type TEXT, abstract TEXT, abstract_rights TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS work_source (
        work_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
        url TEXT NOT NULL, retrieved_at INTEGER NOT NULL, content_hash TEXT NOT NULL,
        PRIMARY KEY(work_id,source,source_id)
      );
      CREATE TABLE IF NOT EXISTS job (
        id TEXT PRIMARY KEY, work_id TEXT NOT NULL, chunk TEXT NOT NULL,
        chunk_index INTEGER NOT NULL, source_json TEXT NOT NULL, status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
        issues TEXT, response_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS job_status ON job(status,lease_until);
      CREATE TABLE IF NOT EXISTS claim (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL, work_id TEXT NOT NULL,
        kind TEXT NOT NULL, payload_json TEXT NOT NULL, issues TEXT NOT NULL,
        review_status TEXT NOT NULL DEFAULT 'needs_review', reviewed_at INTEGER,
        UNIQUE(job_id,kind,payload_json)
      );
      CREATE INDEX IF NOT EXISTS claim_review ON claim(review_status,kind);
    `);
  }

  close() { this.db.close(); }

  seed(source: SourceWork, model: string): number {
    const id = workId(source);
    const now = Date.now();
    const parts = chunks(source.passage);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`INSERT INTO work(id,title,doi,url,year,work_type,abstract,abstract_rights,created_at)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        title=excluded.title,doi=COALESCE(excluded.doi,work.doi),year=COALESCE(excluded.year,work.year),
        abstract=COALESCE(excluded.abstract,work.abstract),abstract_rights=COALESCE(excluded.abstract_rights,work.abstract_rights)`)
        .run(id, source.title, source.doi ?? null, source.url, source.year ?? null, source.workType ?? null,
          source.abstractRights === 'permitted' ? (source.abstract ?? null) : null, source.abstractRights ?? 'unknown', now);
      this.db.prepare(`INSERT INTO work_source(work_id,source,source_id,url,retrieved_at,content_hash) VALUES(?,?,?,?,?,?)
        ON CONFLICT(work_id,source,source_id) DO UPDATE SET retrieved_at=excluded.retrieved_at,content_hash=excluded.content_hash,url=excluded.url`)
        .run(id, source.source, source.sourceId ?? source.url, source.url, now, hash(source.passage));
      const stmt = this.db.prepare(`INSERT OR IGNORE INTO job(id,work_id,chunk,chunk_index,source_json,status,created_at,updated_at)
        VALUES(?,?,?,?,?,'pending',?,?)`);
      let added = 0;
      parts.forEach((part, index) => {
        const jobId = hash([id, hash(source.passage), 'extract', PROMPT_VERSION, model, index].join('|'));
        added += Number(stmt.run(jobId, id, part, index, JSON.stringify({ ...source, passage: undefined }), now, now).changes);
      });
      this.db.exec('COMMIT');
      return added;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  lease(): Job | null {
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(`SELECT id FROM job WHERE (status='pending' OR (status='leased' AND lease_until<?)) AND attempts<3 ORDER BY created_at,id LIMIT 1`).get(now) as {id:string}|undefined;
      if (!row) { this.db.exec('COMMIT'); return null; }
      this.db.prepare(`UPDATE job SET status='leased', attempts=attempts+1,lease_until=?,updated_at=? WHERE id=?`).run(now+300_000,now,row.id);
      const job = this.db.prepare(`SELECT id,work_id,chunk,chunk_index,source_json,status,attempts,lease_until,issues FROM job WHERE id=?`).get(row.id) as unknown as Job;
      this.db.exec('COMMIT');
      return job;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  fail(id: string, error: string) {
    const row = this.db.prepare('SELECT attempts FROM job WHERE id=?').get(id) as {attempts:number}|undefined;
    if (!row) throw new Error('Unknown job');
    this.db.prepare(`UPDATE job SET status=?,issues=?,lease_until=0,updated_at=? WHERE id=?`)
      .run(row.attempts >= 3 ? 'failed' : 'pending', error.slice(0,1000), Date.now(), id);
  }

  complete(job: Job, extraction: Extraction, issues: string[]) {
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`UPDATE job SET status='completed',issues=?,response_json=?,lease_until=0,updated_at=? WHERE id=? AND status='leased'`)
        .run(JSON.stringify(issues), JSON.stringify(extraction), now, job.id);
      const insert = this.db.prepare(`INSERT OR IGNORE INTO claim(id,job_id,work_id,kind,payload_json,issues) VALUES(?,?,?,?,?,?)`);
      const entries: Array<['survey'|'variable'|'theme', unknown]> = [
        ...extraction.claims.map(c => ['survey', c] as ['survey', unknown]),
        ...extraction.variables.map(v => ['variable', v] as ['variable', unknown]),
        ...((extraction.primaryTheme || extraction.additionalThemes.length) ? [['theme', { primary: extraction.primaryTheme, additional: extraction.additionalThemes, rationale: extraction.themeRationale }] as ['theme', unknown]] : []),
      ];
      for (const [kind, payload] of entries) {
        const body = JSON.stringify(payload);
        insert.run(hash(`${job.id}|${kind}|${body}`), job.id, job.work_id, kind, body, JSON.stringify(issues));
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  review(id: string, decision: 'approved'|'rejected') {
    const row = this.db.prepare('SELECT id,issues FROM claim WHERE id=?').get(id) as {id:string;issues:string}|undefined;
    if (!row) throw new Error('Unknown claim');
    if (decision === 'approved' && JSON.parse(row.issues).length) throw new Error('Claim has evidence issues; correct the source/extraction and reprocess');
    this.db.prepare('UPDATE claim SET review_status=?,reviewed_at=? WHERE id=?').run(decision,Date.now(),id);
  }

  stats() {
    return {
      jobs: this.db.prepare('SELECT status,count(*) count FROM job GROUP BY status').all(),
      claims: this.db.prepare('SELECT kind,review_status,count(*) count FROM claim GROUP BY kind,review_status').all(),
      sources: this.db.prepare('SELECT source,count(DISTINCT work_id) works FROM work_source GROUP BY source').all(),
    };
  }

  reviewRows(limit=50) {
    return this.db.prepare(`SELECT c.id,c.kind,c.payload_json,c.issues,w.title,w.url,j.chunk_index
      FROM claim c JOIN work w ON w.id=c.work_id JOIN job j ON j.id=c.job_id
      WHERE c.review_status='needs_review' ORDER BY w.title,c.kind LIMIT ?`).all(limit);
  }

  exportReviewed(): object[] {
    const rows = this.db.prepare(`SELECT c.work_id,c.kind,c.payload_json,w.title,w.doi,w.url,w.year,w.work_type,w.abstract,w.abstract_rights
      FROM claim c JOIN work w ON w.id=c.work_id WHERE c.review_status='approved' ORDER BY c.work_id,c.kind`).all() as Array<Record<string,unknown>>;
    const byWork = new Map<string, any>();
    for (const row of rows) {
      const id=String(row.work_id);
      if (!byWork.has(id)) byWork.set(id,{ id,title:row.title,doi:row.doi,url:row.url,year:row.year,workType:row.work_type,
        abstract:row.abstract,abstractRights:row.abstract_rights,
        sources:this.db.prepare('SELECT source,source_id,url FROM work_source WHERE work_id=? ORDER BY source').all(id), claims:[],themes:[],variables:[] });
      const target=byWork.get(id);
      const payload=JSON.parse(String(row.payload_json));
      if (row.kind==='survey') target.claims.push(payload);
      if (row.kind==='theme') target.themes.push(payload);
      if (row.kind==='variable') target.variables.push(payload);
    }
    return [...byWork.values()].filter(w=>w.claims.some((c: {role:string})=>c.role==='analyzed'));
  }
}
