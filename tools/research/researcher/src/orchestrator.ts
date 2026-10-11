import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ResearchQueue } from './queue.js';
import { harvestOpenAlexAll } from './adapters/openalex.js';
import { assembleCandidates } from './adapters/discovery.js';
import { publicPreview } from './public-preview.js';
import { type CandidateWork } from './model.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PROJECT_ROOT = path.resolve(ROOT, '../../..');
const dbPath = path.join(ROOT, 'out', 'researcher.db');
const previewFile = path.resolve(PROJECT_ROOT, 'platform/hub/src/researcherPilot.json');
const archiveFile = path.join(ROOT, 'out', 'archived-pre-2015.jsonl');
const stateFile = path.join(ROOT, 'out', 'orchestrator_state.json');

export interface OrchestratorState {
  currentStage: 'idle' | 'harvesting' | 'deduping' | 'extracting' | 'auditing' | 'verifying' | 'publishing' | 'completed' | 'failed';
  batchEpoch: string;
  startedAt: number;
  updatedAt: number;
  totalCandidates: number;
  uniqueSources: number;
  reviewedWorks: number;
  publicWorks: number;
  ungroundedClaims: number;
  auditIssues: number;
  lastError?: string;
}

export function saveState(state: OrchestratorState) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export function loadState(): OrchestratorState | null {
  if (fs.existsSync(stateFile)) {
    try {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

const CANONICAL_HARVEST_QUERIES = [
  { program: 'CCHS', query: '"Canadian Community Health Survey"' },
  { program: 'CSD', query: '"Canadian Survey on Disability"' },
  { program: 'CIS', query: '"Canadian Income Survey"' },
  { program: 'CHMS', query: '"Canadian Health Measures Survey"' },
  { program: 'SHS', query: '"Survey of Household Spending"' },
  { program: 'CIUS', query: '"Canadian Internet Use Survey"' },
  { program: 'GSS', query: '"General Social Survey" "Statistics Canada"' },
  { program: 'LFS', query: '"Labour Force Survey" "Statistics Canada"' },
  { program: 'APS', query: '"Aboriginal Peoples Survey"' },
  { program: 'CHS', query: '"Canadian Housing Survey"' },
  { program: 'SFS', query: '"Survey of Financial Security"' },
  { program: 'LSIC', query: '"Longitudinal Survey of Immigrants to Canada"' },
  { program: 'LISA', query: '"Longitudinal and International Study of Adults"' },
  { program: 'CHSCY', query: '"Canadian Health Survey on Children and Youth"' },
  { program: 'EICS', query: '"Employment Insurance Coverage Survey"' },
  { program: 'NGS', query: '"National Graduates Survey"' },
  { program: 'CSS', query: '"Canadian Social Survey"' },
  { program: 'CPSS', query: '"Canadian Perspectives Survey Series"' },
  { program: 'CSCSC', query: '"Canadian Survey of Cyber Security and Cybercrime"' },
  { program: 'SDTIU', query: '"Survey of Digital Technology and Internet Use"' },
  { program: 'SFGSME', query: '"Survey on Financing and Growth of Small and Medium Enterprises"' },
  { program: 'SOLMP', query: '"Survey on the Official Language Minority Population"' },
  { program: 'CTADS', query: '"Canadian Tobacco, Alcohol and Drugs Survey"' },
  { program: 'CTNS', query: '"Canadian Tobacco and Nicotine Survey"' },
  { program: 'HES', query: '"Households and the Environment Survey"' },
  { program: 'PIAAC', query: '"Programme for the International Assessment of Adult Competencies" "Canada"' },
  { program: 'CAFHS', query: '"Canadian Armed Forces Health Survey"' },
  { program: 'IMDB', query: '"Longitudinal Immigration Database"' },
  { program: 'NHS', query: '"National Household Survey" "Statistics Canada"' },
  { program: 'PSES', query: '"Public Service Employee Survey" "Canada"' },
  { program: 'CLPS', query: '"Canadian Legal Problems Survey"' },
  { program: 'CVCS', query: '"Canadian Survey on Victimization and Community Safety"' },
  { program: 'SCMH', query: '"Survey on COVID-19 and Mental Health"' },
  { program: 'CADS', query: '"Canadian Alcohol and Drugs Survey"' },
  { program: 'SMHSE', query: '"Survey on Mental Health and Stressful Events"' },
];

export async function runOrchestratedBatch(options: {
  epochName: string;
  yearFilter: string;
  enableLlmAudit?: boolean;
}) {
  const state: OrchestratorState = {
    currentStage: 'harvesting',
    batchEpoch: options.epochName,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    totalCandidates: 0,
    uniqueSources: 0,
    reviewedWorks: 0,
    publicWorks: 0,
    ungroundedClaims: 0,
    auditIssues: 0,
  };
  saveState(state);

  const q = new ResearchQueue(dbPath);

  try {
    console.log(`\n======================================================`);
    console.log(`[Orchestrator] Starting Batch: ${options.epochName}`);
    console.log(`[Orchestrator] Filter: ${options.yearFilter}`);
    console.log(`======================================================\n`);

    // Stage 1: Harvesting
    console.log(`[Stage 1/5] Executing source discovery via OpenAlex...`);
    const allCandidates: CandidateWork[] = [];
    for (const item of CANONICAL_HARVEST_QUERIES) {
      try {
        const res = await harvestOpenAlexAll(item.query, {
          maxRecords: 75,
        });
        if (res.works.length > 0) {
          console.log(`  ✓ ${item.program}: ${res.works.length} candidates`);
          allCandidates.push(...res.works);
        }
      } catch (err: any) {
        console.warn(`  ! Query warning for ${item.program}: ${err.message || err}`);
      }
      await new Promise(r => setTimeout(r, 100));
    }

    state.totalCandidates = allCandidates.length;
    state.currentStage = 'deduping';
    state.updatedAt = Date.now();
    saveState(state);
    console.log(`\n[Stage 1 Complete] Harvested ${allCandidates.length} raw candidates.`);

    // Stage 2: Assembly & Deduplication
    console.log(`\n[Stage 2/5] Assembling and deduplicating unique sources...`);
    const sources = assembleCandidates(allCandidates);
    state.uniqueSources = sources.length;
    saveState(state);
    console.log(`  ✓ Assembled ${sources.length} unique deduplicated source works.`);

    let seeded = 0;
    for (const s of sources) {
      seeded += q.seed(s, 'deterministic');
    }
    console.log(`  ✓ Seeded ${seeded} extraction jobs into queue.`);

    // Stage 3: Extraction & Reprocessing
    state.currentStage = 'extracting';
    state.updatedAt = Date.now();
    saveState(state);
    console.log(`\n[Stage 3/5] Running deterministic extraction with strict grounding...`);
    const reprocessRes = q.reprocessDeterministic();
    console.log(`  ✓ Reprocessed ${reprocessRes.reprocessed} jobs, ${reprocessRes.claimsUpdated} claims updated.`);

    // Stage 4: Verification & Adversarial Audit
    state.currentStage = 'verifying';
    state.updatedAt = Date.now();
    saveState(state);
    console.log(`\n[Stage 4/5] Executing zero-hallucination verification suite...`);

    const audit = q.audit();
    state.ungroundedClaims = audit.flaggedClaims;
    state.auditIssues = audit.flaggedClaims;
    saveState(state);

    console.log(`  ✓ Flagged Claims: ${audit.flaggedClaims}`);
    console.log(`  ✓ Total Audit Jobs: ${audit.jobs}`);

    if (audit.flaggedClaims > 0) {
      throw new Error(`Verification Gate Failed: Found ${audit.flaggedClaims} flagged claims! Halting publishing.`);
    }

    // Stage 5: Export & Publishing Gate
    state.currentStage = 'publishing';
    state.updatedAt = Date.now();
    saveState(state);
    console.log(`\n[Stage 5/5] Exporting reviewed catalog and executing build gate...`);

    const reviewed = q.exportReviewed();
    state.reviewedWorks = reviewed.length;

    const publicWorks = publicPreview(reviewed, 2015);
    state.publicWorks = publicWorks.length;
    saveState(state);

    console.log(`  ✓ Total reviewed works: ${reviewed.length}`);
    console.log(`  ✓ Active 2015+ public works: ${publicWorks.length}`);

    // Update public preview JSON
    fs.writeFileSync(previewFile, JSON.stringify(publicWorks, null, 2) + '\n', 'utf8');
    console.log(`  ✓ Updated ${previewFile}`);

    // Update archive
    const pre2015 = (reviewed as any[]).filter(w => !w.year || w.year < 2015);
    fs.writeFileSync(archiveFile, pre2015.map(w => JSON.stringify(w)).join('\n') + '\n', 'utf8');

    // Verification tests & Hub build
    console.log(`\n[Build Gate] Running typecheck and production build...`);
    execSync('pnpm --filter @mobilesurvey/hub typecheck', { cwd: PROJECT_ROOT, stdio: 'inherit' });
    execSync('pnpm --filter @mobilesurvey/hub build', { cwd: PROJECT_ROOT, stdio: 'inherit' });
    console.log(`  ✓ Typecheck and Hub build succeeded cleanly.`);

    // Commit and push
    console.log(`\n[Publish Gate] Committing and deploying to GitHub Pages...`);
    execSync('git add platform/hub/src/researcherPilot.json tools/research/researcher/src/orchestrator.ts tools/research/researcher/src/reviewer_agent.ts', { cwd: PROJECT_ROOT, stdio: 'inherit' });
    execSync(`git commit -m "feat(researcher): autonomous batch ${options.epochName} (${publicWorks.length} verified works)"`, { cwd: PROJECT_ROOT, stdio: 'inherit' });
    execSync('git push origin main', { cwd: PROJECT_ROOT, stdio: 'inherit' });
    console.log(`  ✓ Deployed to origin/main successfully!`);

    state.currentStage = 'completed';
    state.updatedAt = Date.now();
    saveState(state);

    q.close();
    return state;
  } catch (err: any) {
    state.currentStage = 'failed';
    state.lastError = err.message || String(err);
    state.updatedAt = Date.now();
    saveState(state);
    q.close();
    throw err;
  }
}

async function waitForUtcMidnightReset() {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 15));
  let diffMs = target.getTime() - now.getTime();
  if (diffMs > 0) {
    console.log(`[Orchestrator] Waiting ${(diffMs / 3600000).toFixed(2)} hours until UTC midnight reset (${target.toISOString()})...`);
    while (diffMs > 0) {
      const waitChunk = Math.min(diffMs, 60_000);
      await new Promise(r => setTimeout(r, waitChunk));
      diffMs = target.getTime() - Date.now();
    }
    console.log(`[Orchestrator] UTC midnight reached! Starting drain.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const epochName = process.env.BATCH_EPOCH || 'Historical Expansion (2015–2019)';
  const yearFilter = process.env.YEAR_FILTER || 'publication_year:2015|2016|2017|2018|2019';
  const shouldWait = process.argv.includes('--wait-for-reset') || process.env.WAIT_FOR_RESET === 'true';

  (async () => {
    if (shouldWait) {
      await waitForUtcMidnightReset();
    }
    return runOrchestratedBatch({ epochName, yearFilter });
  })()
    .then(st => console.log('\n[Orchestrator] Batch Finished Successfully:', st))
    .catch(err => {
      console.error('\n[Orchestrator] Batch Failed:', err);
      process.exit(1);
    });
}
