import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResearchQueue } from './queue.js';
import { extract } from './hermes.js';
import { validateSource, type CandidateWork, type SourceWork } from './model.js';
import { publicPreview } from './public-preview.js';
import { harvestOpenAlexAll, searchOpenAlex } from './adapters/openalex.js';
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

const CANONICAL_HARVEST_QUERIES = [
  { program: 'CCHS', query: '"Canadian Community Health Survey"' },
  { program: 'CCHS', query: '"Enquête sur la santé dans les collectivités canadiennes"' },
  { program: 'CSD', query: '"Canadian Survey on Disability"' },
  { program: 'CSD', query: '"Enquête canadienne sur l\'incapacité"' },
  { program: 'CIS', query: '"Canadian Income Survey"' },
  { program: 'CIS', query: '"Enquête canadienne sur le revenu"' },
  { program: 'CHMS', query: '"Canadian Health Measures Survey"' },
  { program: 'CHMS', query: '"Enquête canadienne sur les mesures de la santé"' },
  { program: 'SHS', query: '"Survey of Household Spending"' },
  { program: 'SHS', query: '"Enquête sur les dépenses des ménages"' },
  { program: 'CIUS', query: '"Canadian Internet Use Survey"' },
  { program: 'CIUS', query: '"Enquête canadienne sur l\'utilisation d\'Internet"' },
  { program: 'GSS', query: '"General Social Survey" "Statistics Canada"' },
  { program: 'GSS', query: '"Canadian General Social Survey"' },
  { program: 'GSS', query: '"Enquête sociale générale" "Statistique Canada"' },
  { program: 'LFS', query: '"Labour Force Survey" "Statistics Canada"' },
  { program: 'LFS', query: '"Canadian Labour Force Survey"' },
  { program: 'LFS', query: '"Enquête sur la population active" "Statistique Canada"' },
  { program: 'APS', query: '"Aboriginal Peoples Survey"' },
  { program: 'APS', query: '"Enquête auprès des peuples autochtones"' },
  { program: 'CHS', query: '"Canadian Housing Survey"' },
  { program: 'CHS', query: '"Enquête canadienne sur le logement"' },
  { program: 'SFS', query: '"Survey of Financial Security"' },
  { program: 'SFS', query: '"Enquête sur la sécurité financière"' },
  { program: 'LSIC', query: '"Longitudinal Survey of Immigrants to Canada"' },
  { program: 'LSIC', query: '"Enquête longitudinale auprès des immigrants du Canada"' },
  { program: 'LISA', query: '"Longitudinal and International Study of Adults"' },
  { program: 'LISA', query: '"Étude longitudinale et internationale des adultes"' },
  { program: 'CHSCY', query: '"Canadian Health Survey on Children and Youth"' },
  { program: 'CHSCY', query: '"Enquête canadienne sur la santé des enfants et des jeunes"' },
  { program: 'EICS', query: '"Employment Insurance Coverage Survey"' },
  { program: 'EICS', query: '"Enquête sur la couverture de l\'assurance-emploi"' },
  { program: 'NGS', query: '"National Graduates Survey"' },
  { program: 'NGS', query: '"Enquête auprès des diplômés"' },
  { program: 'CSS', query: '"Canadian Social Survey"' },
  { program: 'CSS', query: '"Enquête sociale canadienne"' },
  { program: 'CPSS', query: '"Canadian Perspectives Survey Series"' },
  { program: 'CPSS', query: '"Série d’enquêtes sur les perspectives canadiennes"' },
  { program: 'CSCSC', query: '"Canadian Survey of Cyber Security and Cybercrime"' },
  { program: 'CSCSC', query: '"Enquête canadienne sur la cybersécurité et le cybercrime"' },
  { program: 'SDTIU', query: '"Survey of Digital Technology and Internet Use"' },
  { program: 'SDTIU', query: '"Enquête sur les technologies numériques et l\'utilisation d\'Internet"' },
  { program: 'SFGSME', query: '"Survey on Financing and Growth of Small and Medium Enterprises"' },
  { program: 'SFGSME', query: '"Enquête sur le financement et la croissance des petites et moyennes entreprises"' },
  { program: 'SOLMP', query: '"Survey on the Official Language Minority Population"' },
  { program: 'SOLMP', query: '"Enquête sur la population de langue officielle en situation minoritaire"' },
  { program: 'CTADS', query: '"Canadian Tobacco, Alcohol and Drugs Survey"' },
  { program: 'CTADS', query: '"Enquête canadienne sur le tabac, l’alcool et les drogues"' },
  { program: 'CTNS', query: '"Canadian Tobacco and Nicotine Survey"' },
  { program: 'CTNS', query: '"Enquête canadienne sur le tabac et la nicotine"' },
  { program: 'HES', query: '"Households and the Environment Survey"' },
  { program: 'HES', query: '"Enquête sur les ménages et l’environnement"' },
  { program: 'PIAAC', query: '"Programme for the International Assessment of Adult Competencies" "Canada"' },
  { program: 'PIAAC', query: '"Programme pour l’évaluation internationale des compétences des adultes" "Canada"' },
  { program: 'CAFHS', query: '"Canadian Armed Forces Health Survey"' },
  { program: 'CAFHS', query: '"Enquête sur la santé dans les Forces armées canadiennes"' },
  { program: 'CAFVMHS', query: '"Canadian Armed Forces Members and Veterans Mental Health Follow-up Survey"' },
  { program: 'CNICS', query: '"Childhood National Immunization Coverage Survey"' },
  { program: 'CNICS', query: '"Enquête nationale sur la couverture vaccinale des enfants"' },
  { program: 'CSIT', query: '"Canadian Survey on Interprovincial Trade"' },
  { program: 'CSIT', query: '"Enquête canadienne sur le commerce interprovincial"' },
  { program: 'EWHS', query: '"Survey on Working from Home and Working Conditions"' },
  { program: 'PSIS', query: '"Postsecondary Student Information System" "Statistics Canada"' },
  { program: 'RAIS', query: '"Registered Apprenticeship Information System" "Statistics Canada"' },
  { program: 'IMDB', query: '"Longitudinal Immigration Database"' },
  { program: 'IMDB', query: '"Base de données longitudinales sur l’immigration"' },
  { program: 'NHS', query: '"National Household Survey" "Statistics Canada"' },
  { program: 'NHS', query: '"Enquête nationale auprès des ménages" "Statistique Canada"' },
  { program: 'PSES', query: '"Public Service Employee Survey" "Canada"' },
  { program: 'PSES', query: '"Sondage auprès des fonctionnaires fédéraux"' },
  { program: 'CLPS', query: '"Canadian Legal Problems Survey"' },
  { program: 'CVCS', query: '"Canadian Survey on Victimization and Community Safety"' },
  { program: 'SCMH', query: '"Survey on COVID-19 and Mental Health"' },
  { program: 'CADS', query: '"Canadian Alcohol and Drugs Survey"' },
  { program: 'PSSCSC', query: '"Survey on Postsecondary Students Skills and Career Prospects"' },
  { program: 'SMHSE', query: '"Survey on Mental Health and Stressful Events"' },
];

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
    } else if (command === 'reprocess-deterministic' || (command === 'run-deterministic' && (args.includes('--all') || args.includes('--reprocess')))) {
      const res = q.reprocessDeterministic();
      console.log(JSON.stringify({ status: 'completed', reprocessed: res.reprocessed, claimsUpdated: res.claimsUpdated }));
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
    } else if (command === 'harvest-recent') {
      const year = getArgValue('--year') ?? '2025|2026';
      const maxPerQuery = Number(getArgValue('--max-per-query') ?? 2000);
      const outFile = getArgValue('--out') ?? path.join(ROOT, 'out', 'candidates-recent.jsonl');
      const allCandidates: CandidateWork[] = [];

      for (const item of CANONICAL_HARVEST_QUERIES) {
        console.log(`Harvesting ${item.program} (${item.query})...`);
        try {
          const res = await harvestOpenAlexAll(item.query, {
            filter: `publication_year:${year}`,
            maxRecords: maxPerQuery,
            queue: q,
            onProgress: (fetched, total) => {
              process.stdout.write(`  fetched ${fetched}/${total}\r`);
            }
          });
          console.log(`  done: ${res.works.length} works (total index count: ${res.totalCount})`);
          for (const w of res.works) {
            w.suggestedPrograms = [...new Set([...(w.suggestedPrograms ?? []), item.program])];
            allCandidates.push(w);
          }
        } catch (err) {
          console.error(`  Warning: failed to harvest ${item.program} (${item.query}): ${err}`);
        }
        await new Promise(r => setTimeout(r, 400));
      }

      writeFileSync(outFile, allCandidates.map(c => JSON.stringify(c)).join('\n') + '\n', { flag: 'w' });
      console.log(JSON.stringify({ totalCandidates: allCandidates.length, path: outFile }));
    } else if (command === 'discover-openalex') {
      const query = args.find(a => !a.startsWith('--'));
      if (!query) throw new Error('Usage: researcher discover-openalex "<query>" [--limit=N] [--year=YYYY|YYYY] [--filter=...] [--out=candidates.jsonl]');
      const limit = Number(getArgValue('--limit') ?? 25);
      const outFile = getArgValue('--out');
      const year = getArgValue('--year');
      const fetchAll = args.includes('--all');
      let filter = getArgValue('--filter');
      if (year && !filter) {
        filter = `publication_year:${year}`;
      } else if (year && filter && !filter.includes('publication_year:')) {
        filter = `${filter},publication_year:${year}`;
      }
      const res = fetchAll
        ? await harvestOpenAlexAll(query, { maxRecords: limit, queue: q, filter: filter ?? undefined })
        : await searchOpenAlex(query, { perPage: limit, queue: q, filter: filter ?? undefined });
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
      throw new Error('Commands: seed | run | status | report | audit | reset-failed | review | approve | reject | export | preview | discover-openalex | harvest-recent | enrich-crossref | parse-crdcn | assemble | evaluate');
    }
  } finally {
    q.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
