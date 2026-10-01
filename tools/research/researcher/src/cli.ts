import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResearchQueue } from './queue.js';
import { extract } from './hermes.js';
import { validateSource, type CandidateWork, type SourceWork } from './model.js';
import { publicPreview } from './public-preview.js';
import { searchOpenAlex } from './adapters/openalex.js';
import { fetchCrossrefDoi, searchCrossref } from './adapters/crossref.js';
import { fetchCrdcnPage, parseCrdcnHtml } from './adapters/crdcn.js';
import { assembleCandidates } from './adapters/discovery.js';
import { evaluateExtractionAgainstGold, type GoldRecord } from './evaluation.js';
import { extractDeterministic } from './deterministic.js';
import { getGreyLiteratureCandidates } from './adapters/grey-literature.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.RESEARCHER_DB ?? path.join(ROOT, 'out', 'researcher.db');
const model = process.env.LOCAL_LLM_MODEL ?? 'qwen3.8-27b';
const endpoint = process.env.LOCAL_LLM_URL ?? 'http://127.0.0.1:1234/v1';
const [command, ...args] = process.argv.slice(2);

function getArgValue(flag: string): string | undefined {
  const match = args.find(a => a.startsWith(`${flag}=`));
  if (match) return match.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  const lines = createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
  const records: T[] = [];
  for await (const line of lines) {
    if (line.trim()) records.push(JSON.parse(line));
  }
  return records;
}

async function main() {
  const q = new ResearchQueue(dbPath);
  try {
    if (command === 'seed') {
      if (!args[0]) throw new Error('Usage: researcher seed <sources.jsonl>');
      const lines = createInterface({ input: createReadStream(args[0], { encoding: 'utf8' }), crlfDelay: Infinity });
      let works = 0, jobs = 0;
      for await (const line of lines) {
        if (!line.trim()) continue;
        const source = validateSource(JSON.parse(line));
        jobs += q.seed(source, model); works++;
      }
      console.log(JSON.stringify({ worksRead: works, jobsAdded: jobs }));
    } else if (command === 'run' || command === 'run-deterministic') {
      const isDeterministic = command === 'run-deterministic' || args.includes('--deterministic');
      const numArg = args.find(a => !a.startsWith('--'));
      const limit = numArg ? Number(numArg) : 25;
      if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('Run limit must be 1..10000');
      for (let n = 0; n < limit; n++) {
        const job = q.lease(); if (!job) break;
        try {
          const source = JSON.parse(job.source_json) as SourceWork;
          const result = isDeterministic
            ? extractDeterministic(source, job.chunk)
            : await extract(source, job.chunk, endpoint, model);
          q.complete(job, result.value, result.issues);
          console.log(JSON.stringify({ job: job.id, status: 'completed', claims: result.value.claims.length, issues: result.issues }));
        } catch (error) {
          const message = String(error);
          const retryable = !/Local model HTTP 4\d\d/.test(message);
          q.fail(job.id, message, retryable);
          console.error(JSON.stringify({ job: job.id, status: retryable ? 'retry' : 'failed', error: message }));
        }
      }
    } else if (command === 'status') {
      console.log(JSON.stringify(q.stats(), null, 2));
    } else if (command === 'report') {
      console.log(JSON.stringify(q.report(), null, 2));
    } else if (command === 'audit') {
      console.log(JSON.stringify(q.audit()));
    } else if (command === 'reset-failed') {
      console.log(JSON.stringify({ jobsReset: q.resetFailed() }));
    } else if (command === 'review') {
      console.log(JSON.stringify(q.reviewRows(args[0] ? Number(args[0]) : 50), null, 2));
    } else if (command === 'approve-clean') {
      const count = q.approveClean();
      console.log(JSON.stringify({ approvedCleanClaims: count }));
    } else if (command === 'approve' || command === 'reject') {
      if (!args[0]) throw new Error(`Usage: researcher ${command} <claim-id>`);
      q.review(args[0], command === 'approve' ? 'approved' : 'rejected');
      console.log(`${command}d ${args[0]}`);
    } else if (command === 'export') {
      if (!args[0]) throw new Error('Usage: researcher export <reviewed.jsonl>');
      const records = q.exportReviewed();
      writeFileSync(args[0], records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), { flag: 'w' });
      console.log(JSON.stringify({ reviewedWorks: records.length, path: args[0] }));
    } else if (command === 'preview') {
      if (!args[0]) throw new Error('Usage: researcher preview <public.json>');
      const records = publicPreview(q.exportReviewed());
      writeFileSync(args[0], JSON.stringify(records, null, 2) + '\n', { flag: 'w' });
      console.log(JSON.stringify({ publicPilotWorks: records.length, path: args[0] }));
    } else if (command === 'compile-grey-literature') {
      const outFile = getArgValue('--out') ?? path.join(ROOT, 'out', 'grey-literature.jsonl');
      const candidates = getGreyLiteratureCandidates();
      writeFileSync(outFile, candidates.map(c => JSON.stringify(c)).join('\n') + '\n', { flag: 'w' });
      console.log(JSON.stringify({ greyLiteratureWorks: candidates.length, path: outFile }));
    } else if (command === 'discover-openalex') {
      const query = args.find(a => !a.startsWith('--'));
      if (!query) throw new Error('Usage: researcher discover-openalex "<query>" [--limit=N] [--year=YYYY|YYYY] [--filter=...] [--out=candidates.jsonl]');
      const limit = Number(getArgValue('--limit') ?? 25);
      const outFile = getArgValue('--out');
      const year = getArgValue('--year');
      let filter = getArgValue('--filter');
      if (year && !filter) {
        filter = `publication_year:${year}`;
      } else if (year && filter && !filter.includes('publication_year:')) {
        filter = `${filter},publication_year:${year}`;
      }
      const res = await searchOpenAlex(query, { perPage: limit, queue: q, filter: filter ?? undefined });
      console.log(`Discovered ${res.works.length} works from OpenAlex (total in index: ${res.totalCount})`);
      if (outFile) {
        writeFileSync(outFile, res.works.map(w => JSON.stringify(w)).join('\n') + '\n', { flag: 'w' });
        console.log(`Wrote candidates to ${outFile}`);
      } else {
        console.log(JSON.stringify(res.works.slice(0, 5), null, 2));
      }
    } else if (command === 'enrich-crossref') {
      const target = args.find(a => !a.startsWith('--'));
      if (!target) throw new Error('Usage: researcher enrich-crossref <doi|jsonl-file> [--out=candidates.jsonl]');
      const outFile = getArgValue('--out');
      let candidates: CandidateWork[] = [];
      if (target.endsWith('.jsonl')) {
        const items = await readJsonl<{ doi?: string }>(target);
        for (const item of items) {
          if (!item.doi) continue;
          const found = await fetchCrossrefDoi(item.doi, { queue: q });
          if (found) candidates.push(found);
        }
      } else if (target.startsWith('10.') || target.includes('doi.org/')) {
        const found = await fetchCrossrefDoi(target, { queue: q });
        if (found) candidates.push(found);
      } else {
        const res = await searchCrossref(target, { rows: Number(getArgValue('--limit') ?? 25), queue: q });
        candidates = res.works;
      }
      console.log(`Enriched ${candidates.length} works from Crossref`);
      if (outFile) {
        writeFileSync(outFile, candidates.map(w => JSON.stringify(w)).join('\n') + '\n', { flag: 'w' });
        console.log(`Wrote candidates to ${outFile}`);
      } else {
        console.log(JSON.stringify(candidates.slice(0, 5), null, 2));
      }
    } else if (command === 'parse-crdcn') {
      const target = args.find(a => !a.startsWith('--'));
      if (!target) throw new Error('Usage: researcher parse-crdcn <url-or-html-file> [--out=candidates.jsonl]');
      const outFile = getArgValue('--out');
      let candidate: CandidateWork | null = null;
      if (target.startsWith('http://') || target.startsWith('https://')) {
        candidate = await fetchCrdcnPage(target, { queue: q });
      } else {
        const html = readFileSync(target, 'utf8');
        candidate = parseCrdcnHtml(html, `file://${path.resolve(target)}`);
      }
      if (!candidate) console.log('No candidate extracted from CRDCN source');
      else {
        console.log(`Parsed CRDCN: "${candidate.title}" (DOI: ${candidate.doi ?? 'none'}, Programs: ${candidate.suggestedPrograms?.join(', ') || 'none'})`);
        if (outFile) {
          writeFileSync(outFile, JSON.stringify(candidate) + '\n', { flag: 'w' });
        }
      }
    } else if (command === 'assemble') {
      const candidateFiles = args.filter(a => !a.startsWith('--'));
      const outFile = getArgValue('--out');
      if (!candidateFiles.length || !outFile) throw new Error('Usage: researcher assemble <cand1.jsonl> [cand2.jsonl...] --out=<sources.jsonl>');
      const rawCandidates: CandidateWork[] = [];
      for (const file of candidateFiles) {
        const list = await readJsonl<CandidateWork>(file);
        rawCandidates.push(...list);
      }
      const targetSurveysArg = getArgValue('--surveys');
      const targetSurveys = targetSurveysArg ? targetSurveysArg.split(',').map(s => s.trim().toUpperCase()) : undefined;
      const sources = assembleCandidates(rawCandidates, { targetSurveys });
      writeFileSync(outFile, sources.map(s => JSON.stringify(s)).join('\n') + '\n', { flag: 'w' });
      console.log(JSON.stringify({ rawCandidates: rawCandidates.length, assembledSources: sources.length, path: outFile }));
    } else if (command === 'evaluate') {
      const goldFile = args.find(a => !a.startsWith('--'));
      if (!goldFile) throw new Error('Usage: researcher evaluate <gold-set.jsonl>');
      const goldRecords = await readJsonl<GoldRecord>(goldFile);
      const reviewed = q.exportReviewed() as Array<{ id: string; claims: any[]; themes?: any[] }>;
      const report = evaluateExtractionAgainstGold(goldRecords, reviewed);
      console.log(JSON.stringify(report, null, 2));
    } else {
      throw new Error('Commands: seed | run | status | report | audit | reset-failed | review | approve | reject | export | preview | discover-openalex | enrich-crossref | parse-crdcn | assemble | evaluate');
    }
  } finally {
    q.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
