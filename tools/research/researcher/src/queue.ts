import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chunks, hash, PROMPT_VERSION, validateExtraction, type Extraction, type SourceWork, workId } from './model.js';

function entryIssues(issues: string[], kind: 'survey'|'variable'|'theme', index: number): string[] {
  if (kind === 'theme') return issues.filter(issue => issue.startsWith('unknown primary theme') || issue.startsWith('unknown additional theme'));
  return issues.filter(issue => issue.startsWith(`${kind === 'survey' ? 'claim' : 'variable'} ${index}:`));
}

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
        year INTEGER, work_type TEXT, issuing_organization TEXT, abstract TEXT, abstract_rights TEXT,
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
      CREATE TABLE IF NOT EXISTS adapter_checkpoint (
        adapter TEXT NOT NULL, cache_key TEXT NOT NULL, url TEXT NOT NULL,
        retrieved_at INTEGER NOT NULL, status_code INTEGER NOT NULL,
        content_hash TEXT NOT NULL, response_body TEXT NOT NULL,
        PRIMARY KEY(adapter,cache_key)
      );
    `);
    const workColumns = this.db.prepare('PRAGMA table_info(work)').all() as Array<{ name: string }>;
    if (!workColumns.some(column => column.name === 'issuing_organization'))
      this.db.exec('ALTER TABLE work ADD COLUMN issuing_organization TEXT');
  }

  close() { this.db.close(); }

  seed(source: SourceWork, model: string): number {
    const id = workId(source);
    const now = Date.now();
    const parts = chunks(source.passage);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`INSERT INTO work(id,title,doi,url,year,work_type,issuing_organization,abstract,abstract_rights,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        title=excluded.title,doi=COALESCE(excluded.doi,work.doi),year=COALESCE(excluded.year,work.year),
        issuing_organization=COALESCE(excluded.issuing_organization,work.issuing_organization),
        abstract=COALESCE(excluded.abstract,work.abstract),abstract_rights=COALESCE(excluded.abstract_rights,work.abstract_rights)`)
        .run(id, source.title, source.doi ?? null, source.url, source.year ?? null, source.workType ?? null, source.issuingOrganization ?? null,
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
      const row = this.db.prepare(`SELECT id FROM job WHERE ((status='pending' AND lease_until<=?) OR (status='leased' AND lease_until<?)) AND attempts<3 ORDER BY created_at,id LIMIT 1`).get(now,now) as {id:string}|undefined;
      if (!row) { this.db.exec('COMMIT'); return null; }
      this.db.prepare(`UPDATE job SET status='leased', attempts=attempts+1,lease_until=?,updated_at=? WHERE id=?`).run(now+300_000,now,row.id);
      const job = this.db.prepare(`SELECT id,work_id,chunk,chunk_index,source_json,status,attempts,lease_until,issues FROM job WHERE id=?`).get(row.id) as unknown as Job;
      this.db.exec('COMMIT');
      return job;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  fail(id: string, error: string, retryable = true) {
    const row = this.db.prepare('SELECT attempts FROM job WHERE id=?').get(id) as {attempts:number}|undefined;
    if (!row) throw new Error('Unknown job');
    this.db.prepare(`UPDATE job SET status=?,issues=?,lease_until=0,updated_at=? WHERE id=?`)
      .run(!retryable || row.attempts >= 3 ? 'failed' : 'pending', error.slice(0,1000), Date.now(), id);
    if (retryable && row.attempts < 3)
      this.db.prepare('UPDATE job SET lease_until=? WHERE id=?').run(Date.now()+Math.min(60_000, 5_000*2**(row.attempts-1)),id);
  }

  resetFailed(): number {
    return Number(this.db.prepare(`UPDATE job SET status='pending',attempts=0,lease_until=0,issues=NULL,updated_at=? WHERE status='failed'`).run(Date.now()).changes);
  }

  complete(job: Job, extraction: Extraction, issues: string[]) {
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`UPDATE job SET status='completed',issues=?,response_json=?,lease_until=0,updated_at=? WHERE id=? AND status='leased'`)
        .run(JSON.stringify(issues), JSON.stringify(extraction), now, job.id);
      const insert = this.db.prepare(`INSERT OR IGNORE INTO claim(id,job_id,work_id,kind,payload_json,issues) VALUES(?,?,?,?,?,?)`);
      const entries: Array<['survey'|'variable'|'theme', unknown, number]> = [
        ...extraction.claims.map((c,index) => ['survey', c, index] as ['survey', unknown, number]),
        ...extraction.variables.map((v,index) => ['variable', v, index] as ['variable', unknown, number]),
        ...((extraction.primaryTheme || extraction.additionalThemes.length) ? [['theme', { primary: extraction.primaryTheme, additional: extraction.additionalThemes, rationale: extraction.themeRationale }, 0] as ['theme', unknown, number]] : []),
      ];
      for (const [kind, payload, index] of entries) {
        const body = JSON.stringify(payload);
        insert.run(hash(`${job.id}|${kind}|${body}`), job.id, job.work_id, kind, body, JSON.stringify(entryIssues(issues,kind,index)));
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  audit(): { jobs: number; flaggedClaims: number } {
    const jobs=this.db.prepare(`SELECT id,chunk,source_json,response_json FROM job WHERE status='completed'`).all() as Array<{id:string;chunk:string;source_json:string;response_json:string}>;
    let flaggedClaims=0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const update=this.db.prepare(`UPDATE claim SET issues=?,review_status=CASE WHEN ? <> '[]' AND review_status='approved' THEN 'needs_review' ELSE review_status END WHERE job_id=? AND kind=? AND payload_json=?`);
      const updateJob=this.db.prepare('UPDATE job SET issues=? WHERE id=?');
      for (const job of jobs) {
        const source=JSON.parse(job.source_json) as SourceWork;
        const {value,issues}=validateExtraction(JSON.parse(job.response_json),job.chunk,source.surveyCandidates);
        updateJob.run(JSON.stringify(issues),job.id);
        const entries: Array<['survey'|'variable'|'theme',unknown,number]>=[
          ...value.claims.map((claim,index)=>['survey',claim,index] as ['survey',unknown,number]),
          ...value.variables.map((variable,index)=>['variable',variable,index] as ['variable',unknown,number]),
          ...((value.primaryTheme || value.additionalThemes.length) ? [['theme',{primary:value.primaryTheme,additional:value.additionalThemes,rationale:value.themeRationale},0] as ['theme',unknown,number]] : []),
        ];
        for (const [kind,payload,index] of entries) {
          const scoped=entryIssues(issues,kind,index);
          if (scoped.length) flaggedClaims++;
          const json=JSON.stringify(scoped);
          update.run(json,json,job.id,kind,JSON.stringify(payload));
        }
      }
      this.db.exec('COMMIT');
      return {jobs:jobs.length,flaggedClaims};
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
  }

  review(id: string, decision: 'approved'|'rejected') {
    const row = this.db.prepare('SELECT id,issues FROM claim WHERE id=?').get(id) as {id:string;issues:string}|undefined;
    if (!row) throw new Error('Unknown claim');
    if (decision === 'approved' && JSON.parse(row.issues).length) throw new Error('Claim has evidence issues; correct the source/extraction and reprocess');
    this.db.prepare('UPDATE claim SET review_status=?,reviewed_at=? WHERE id=?').run(decision,Date.now(),id);
  }

  approveClean(): number {
    const rows = this.db.prepare("SELECT id FROM claim WHERE review_status='needs_review' AND (issues IS NULL OR issues='[]')").all() as Array<{id: string}>;
    let count = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const stmt = this.db.prepare("UPDATE claim SET review_status='approved', reviewed_at=? WHERE id=?");
      const now = Date.now();
      for (const row of rows) {
        stmt.run(now, row.id);
        count++;
      }
      this.db.exec('COMMIT');
      return count;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  stats() {
    return {
      jobs: this.db.prepare('SELECT status,count(*) count FROM job GROUP BY status').all(),
      claims: this.db.prepare('SELECT kind,review_status,count(*) count FROM claim GROUP BY kind,review_status').all(),
      sources: this.db.prepare('SELECT source,count(DISTINCT work_id) works FROM work_source GROUP BY source').all(),
    };
  }

  getCachedResponse(adapter: string, cacheKey: string): {
    url: string; retrievedAt: number; statusCode: number; contentHash: string; responseBody: string;
  } | null {
    const row = this.db.prepare(
      'SELECT url, retrieved_at, status_code, content_hash, response_body FROM adapter_checkpoint WHERE adapter=? AND cache_key=?'
    ).get(adapter, cacheKey) as { url: string; retrieved_at: number; status_code: number; content_hash: string; response_body: string } | undefined;
    if (!row) return null;
    return {
      url: row.url,
      retrievedAt: row.retrieved_at,
      statusCode: row.status_code,
      contentHash: row.content_hash,
      responseBody: row.response_body,
    };
  }

  setCachedResponse(adapter: string, cacheKey: string, url: string, statusCode: number, responseBody: string): void {
    const now = Date.now();
    const contentHash = hash(responseBody);
    this.db.prepare(
      `INSERT INTO adapter_checkpoint(adapter, cache_key, url, retrieved_at, status_code, content_hash, response_body)
       VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(adapter, cache_key) DO UPDATE SET
         url=excluded.url, retrieved_at=excluded.retrieved_at, status_code=excluded.status_code,
         content_hash=excluded.content_hash, response_body=excluded.response_body`
    ).run(adapter, cacheKey, url, now, statusCode, contentHash, responseBody);
  }

  report() {
    const totalWorks = (this.db.prepare('SELECT count(*) as count FROM work').get() as { count: number }).count;
    const worksWithDoi = (this.db.prepare('SELECT count(*) as count FROM work WHERE doi IS NOT NULL').get() as { count: number }).count;
    const worksWithAbstract = (this.db.prepare('SELECT count(*) as count FROM work WHERE abstract IS NOT NULL').get() as { count: number }).count;
    const abstractRights = this.db.prepare("SELECT COALESCE(abstract_rights, 'unknown') as rights, count(*) as count FROM work GROUP BY abstract_rights").all();

    const sourceMemberships = this.db.prepare(`
      SELECT work_id, count(DISTINCT source) as source_count
      FROM work_source GROUP BY work_id
    `).all() as Array<{ work_id: string; source_count: number }>;
    const singleSource = sourceMemberships.filter(m => m.source_count === 1).length;
    const multiSource = sourceMemberships.filter(m => m.source_count > 1).length;

    const sourcesBreakdown = this.db.prepare(`
      SELECT source, count(DISTINCT work_id) as works_count FROM work_source GROUP BY source ORDER BY works_count DESC
    `).all();

    const jobsByStatus = this.db.prepare('SELECT status, count(*) as count FROM job GROUP BY status').all();
    const jobsByAttempts = this.db.prepare('SELECT attempts, count(*) as count FROM job GROUP BY attempts').all();

    const claimsByReviewStatus = this.db.prepare('SELECT kind, review_status, count(*) as count FROM claim GROUP BY kind, review_status').all();

    const surveyClaims = this.db.prepare(`SELECT payload_json, review_status FROM claim WHERE kind='survey'`).all() as Array<{ payload_json: string; review_status: string }>;
    const precisionCounts = {
      approved: { exact_cycles: 0, range: 0, program_only: 0 },
      needs_review: { exact_cycles: 0, range: 0, program_only: 0 },
      rejected: { exact_cycles: 0, range: 0, program_only: 0 },
    };
    const roleCounts = {
      approved: { analyzed: 0, comparison: 0, background_mention: 0 },
      needs_review: { analyzed: 0, comparison: 0, background_mention: 0 },
      rejected: { analyzed: 0, comparison: 0, background_mention: 0 },
    };
    for (const row of surveyClaims) {
      try {
        const claim = JSON.parse(row.payload_json);
        const status = row.review_status as 'approved' | 'needs_review' | 'rejected';
        if (precisionCounts[status] && claim.precision in precisionCounts[status]) {
          precisionCounts[status][claim.precision as keyof typeof precisionCounts[typeof status]]++;
        }
        if (roleCounts[status] && claim.role in roleCounts[status]) {
          roleCounts[status][claim.role as keyof typeof roleCounts[typeof status]]++;
        }
      } catch {}
    }

    const flagged = (this.db.prepare(`SELECT count(*) as count FROM claim WHERE issues <> '[]'`).get() as { count: number }).count;
    const adapterCache = this.db.prepare('SELECT adapter, count(*) as count FROM adapter_checkpoint GROUP BY adapter').all();

    return {
      inventory: { totalWorks, worksWithDoi, worksWithAbstract, abstractRights },
      sources: { singleSource, multiSource, bySource: sourcesBreakdown },
      jobs: { byStatus: jobsByStatus, byAttempts: jobsByAttempts },
      claims: {
        byKindAndStatus: claimsByReviewStatus,
        flaggedWithEvidenceIssues: flagged,
        surveyRoleCounts: roleCounts,
        analyzedPrecisionCounts: precisionCounts,
      },
      adapterCache,
    };
  }

  reviewRows(limit=50) {
    return this.db.prepare(`SELECT c.id,c.kind,c.payload_json,c.issues,w.title,w.url,j.chunk_index
      FROM claim c JOIN work w ON w.id=c.work_id JOIN job j ON j.id=c.job_id
      WHERE c.review_status='needs_review' ORDER BY w.title,c.kind LIMIT ?`).all(limit);
  }

  exportReviewed(): object[] {
    const rows = this.db.prepare(`SELECT c.work_id,c.kind,c.payload_json,w.title,w.doi,w.url,w.year,w.work_type,w.issuing_organization,w.abstract,w.abstract_rights
      FROM claim c JOIN work w ON w.id=c.work_id WHERE c.review_status='approved' ORDER BY c.work_id,c.kind`).all() as Array<Record<string,unknown>>;
    const byWork = new Map<string, any>();
    for (const row of rows) {
      const id=String(row.work_id);
      if (!byWork.has(id)) byWork.set(id,{ id,title:row.title,doi:row.doi,url:row.url,year:row.year,workType:row.work_type,issuingOrganization:row.issuing_organization,
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
