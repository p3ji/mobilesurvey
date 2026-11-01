import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ResearchQueue } from './queue.js';
import { harvestOpenAlexAll } from './adapters/openalex.js';
import { harvestCrdcnPublications } from './adapters/crdcn.js';
import { harvestAllScholarisTheses } from './adapters/institutional_repositories.js';
import { harvestAllHealthAuthorities } from './adapters/public_health_harvester.js';
import { assembleCandidates } from './adapters/discovery.js';
import { publicPreview } from './public-preview.js';
import { CANONICAL_SURVEYS, type CandidateWork, type Claim } from './model.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PROJECT_ROOT = path.resolve(ROOT, '../../..');
const dbPath = path.join(ROOT, 'out', 'researcher.db');
const previewFile = path.resolve(PROJECT_ROOT, 'platform/hub/src/researcherPilot.json');
const runsDir = path.join(ROOT, 'out', 'nightly_runs');

export interface NightlyEnrichmentOptions {
  deploy?: boolean;
  dryRun?: boolean;
  skipHarvest?: boolean;
  skipLlm?: boolean;
  llmLimit?: number;
  minYear?: number;
  localLlmUrl?: string;
  localLlmModel?: string;
}

export interface NightlyRunReport {
  timestamp: string;
  durationMs: number;
  harvest: {
    openAlex: number;
    crdcn: number;
    scholarisTheses: number;
    publicHealth: number;
    totalRawCandidates: number;
    uniqueSources: number;
    jobsSeeded: number;
  };
  enrichment: {
    deterministicReprocessed: number;
    claimsUpdated: number;
    llmDisambiguated: number;
    programOnlyResolved: number;
    provisionalElevated: number;
  };
  audit: {
    totalJobs: number;
    flaggedClaims: number;
    gatePassed: boolean;
  };
  catalogue: {
    totalPublicWorks: number;
    verifiedCount: number;
    provisionalCount: number;
    verifiedPercentage: string;
  };
  deployment: {
    attempted: boolean;
    committed: boolean;
    pushed: boolean;
    commitHash?: string;
  };
}

/**
 * Checks whether an HTTP port on localhost is active.
 */
async function isPortReachable(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/models`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Executes a targeted local LLM precision pass on program_only or provisional claims.
 * Uses microsoft/phi-4 on LM Studio (port 1234) with strict JSON output and validation.
 */
async function runLocalLlmEnrichmentPass(
  q: ResearchQueue,
  options: {
    limit: number;
    endpoint: string;
    model: string;
    onProgress?: (msg: string) => void;
  }
): Promise<{ llmDisambiguated: number; programOnlyResolved: number; provisionalElevated: number }> {
  const log = options.onProgress ?? console.log;
  let llmDisambiguated = 0;
  let programOnlyResolved = 0;
  let provisionalElevated = 0;

  // Query jobs that have program_only precision claims
  const candidateJobs = (q as any).db.prepare(`
    SELECT DISTINCT j.id, j.chunk, j.source_json, j.response_json
    FROM job j
    JOIN claim c ON c.job_id = j.id
    WHERE j.status = 'completed'
      AND c.kind = 'survey'
      AND (json_extract(c.payload_json, '$.precision') = 'program_only'
           OR json_extract(c.payload_json, '$.certainty') = 'provisional')
    LIMIT ?
  `).all(options.limit) as Array<{
    id: string;
    chunk: string;
    source_json: string;
    response_json: string;
  }>;

  if (candidateJobs.length === 0) {
    log('  No eligible claims requiring LLM disambiguation in current batch.');
    return { llmDisambiguated, programOnlyResolved, provisionalElevated };
  }

  log(`  Found ${candidateJobs.length} candidate jobs for local LLM refinement.`);

  const updateClaimStmt = (q as any).db.prepare(`
    UPDATE claim SET payload_json = ?, issues = '[]', review_status = 'approved'
    WHERE job_id = ? AND kind = 'survey'
  `);
  const updateJobStmt = (q as any).db.prepare(`
    UPDATE job SET response_json = ?, updated_at = ? WHERE id = ?
  `);

  for (let i = 0; i < candidateJobs.length; i++) {
    const job = candidateJobs[i]!;
    let extraction: any;
    try {
      extraction = JSON.parse(job.response_json);
    } catch {
      continue;
    }

    if (!Array.isArray(extraction?.claims) || extraction.claims.length === 0) continue;

    for (const claim of extraction.claims as Claim[]) {
      const spec = CANONICAL_SURVEYS[claim.program];
      if (!spec) continue;

      const prompt = {
        task: 'Extract survey collection cycles and microdata analysis confirmation',
        program: spec.program,
        surveyName: spec.name,
        validCycles: spec.validCycles,
        passage: job.chunk.slice(0, 3000),
      };

      try {
        const res = await fetch(`${options.endpoint.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(30000),
          body: JSON.stringify({
            model: options.model,
            temperature: 0,
            max_tokens: 300,
            messages: [
              {
                role: 'system',
                content: `You are an expert Statistics Canada microdata auditor.
Given an excerpt from a research paper and a target survey, extract:
1. Exact survey collection cycle years (e.g. ["2017", "2018"]) ONLY if explicitly mentioned in the text as collection or analysis periods. Ignore secondary citation years like (Statistics Canada, 2013).
2. Whether the study actively analyzes microdata (role="analyzed") versus passing background citation (role="background_mention").
3. A verbatim quote substring from the passage supporting this.
Return JSON ONLY:
{
  "exactCycles": ["YYYY"],
  "cycleText": "string",
  "isStatCanExplicit": boolean,
  "verbatimQuote": "exact substring from passage"
}`,
              },
              { role: 'user', content: JSON.stringify(prompt) },
            ],
            response_format: { type: 'json_object' },
          }),
        });

        if (!res.ok) continue;
        const data = await res.json() as any;
        const content = data.choices?.[0]?.message?.content;
        if (!content) continue;

        const parsed = JSON.parse(content) as {
          exactCycles?: string[];
          cycleText?: string;
          isStatCanExplicit?: boolean;
          verbatimQuote?: string;
        };

        let updated = false;

        // Check if cycle resolution is valid
        if (Array.isArray(parsed.exactCycles) && parsed.exactCycles.length > 0) {
          const validSet = new Set(spec.validCycles || []);
          const cleanCycles = parsed.exactCycles.filter(y => validSet.has(y));
          if (cleanCycles.length > 0) {
            claim.exactCycles = cleanCycles;
            claim.cycleText = parsed.cycleText || cleanCycles.join(', ');
            claim.precision = cleanCycles.length > 1 ? 'range' : 'exact_cycles';
            programOnlyResolved++;
            updated = true;
          }
        }

        // Check if quote is a true verbatim substring
        if (parsed.verbatimQuote && job.chunk.includes(parsed.verbatimQuote)) {
          claim.quote = parsed.verbatimQuote;
          updated = true;
        }

        // Check certainty elevation
        if (parsed.isStatCanExplicit === true && claim.certainty !== 'verified') {
          claim.certainty = 'verified';
          claim.statCanExplicit = true;
          provisionalElevated++;
          updated = true;
        }

        if (updated) {
          updateClaimStmt.run(JSON.stringify(claim), job.id);
          updateJobStmt.run(JSON.stringify(extraction), Date.now(), job.id);
          llmDisambiguated++;
        }
      } catch {
        // Continue politely
      }
    }
  }

  log(`  ✓ Local LLM completed: ${llmDisambiguated} claims refined (${programOnlyResolved} cycles resolved, ${provisionalElevated} elevated to verified).`);
  return { llmDisambiguated, programOnlyResolved, provisionalElevated };
}

/**
 * Main Autonomous Daily Nightly Enrichment Pipeline
 */
export async function runNightlyEnrichment(options: NightlyEnrichmentOptions = {}): Promise<NightlyRunReport> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const minYear = options.minYear ?? 2025; // Focus nightly scan on recent trailing window
  const localLlmUrl = options.localLlmUrl ?? process.env.LOCAL_LLM_URL ?? 'http://127.0.0.1:1234/v1';
  const localLlmModel = options.localLlmModel ?? process.env.LOCAL_LLM_MODEL ?? 'microsoft/phi-4';

  console.log(`\n================================================================`);
  console.log(`[Researcher Nightly Enrichment] Commencing Daily Scheduled Run`);
  console.log(`Timestamp: ${timestamp}`);
  console.log(`Horizon: ${minYear}–2026 rolling scan + continuous precision disambiguation`);
  console.log(`================================================================\n`);

  const q = new ResearchQueue(dbPath);

  const report: NightlyRunReport = {
    timestamp,
    durationMs: 0,
    harvest: {
      openAlex: 0,
      crdcn: 0,
      scholarisTheses: 0,
      publicHealth: 0,
      totalRawCandidates: 0,
      uniqueSources: 0,
      jobsSeeded: 0,
    },
    enrichment: {
      deterministicReprocessed: 0,
      claimsUpdated: 0,
      llmDisambiguated: 0,
      programOnlyResolved: 0,
      provisionalElevated: 0,
    },
    audit: {
      totalJobs: 0,
      flaggedClaims: 0,
      gatePassed: false,
    },
    catalogue: {
      totalPublicWorks: 0,
      verifiedCount: 0,
      provisionalCount: 0,
      verifiedPercentage: '0%',
    },
    deployment: {
      attempted: Boolean(options.deploy),
      committed: false,
      pushed: false,
    },
  };

  try {
    // ── STAGE 1: Incremental Multi-Sector Harvester ─────────────────────────
    const rawCandidates: CandidateWork[] = [];

    if (!options.skipHarvest) {
      console.log('[Stage 1/6] Running Incremental Multi-Sector Harvesters...');

      // 1a. OpenAlex Recent Additions (top canonical health & social surveys)
      console.log('  -> Scanning OpenAlex for recent additions (2025–2026)...');
      const topSurveys = [
        { program: 'CCHS', query: '"Canadian Community Health Survey"' },
        { program: 'LFS', query: '"Labour Force Survey" "Statistics Canada"' },
        { program: 'GSS', query: '"General Social Survey" "Statistics Canada"' },
        { program: 'CIS', query: '"Canadian Income Survey"' },
        { program: 'CSD', query: '"Canadian Survey on Disability"' },
      ];
      for (const item of topSurveys) {
        try {
          const res = await harvestOpenAlexAll(item.query, {
            filter: `publication_year:${minYear}|2026`,
            maxRecords: 100,
            queue: q,
          });
          for (const w of res.works) {
            w.suggestedPrograms = [item.program];
            rawCandidates.push(w);
          }
          report.harvest.openAlex += res.works.length;
        } catch {
          // Continue politely
        }
        await new Promise(r => setTimeout(r, 200));
      }
      console.log(`     ✓ OpenAlex: ${report.harvest.openAlex} recent candidate works.`);

      // 1b. CRDCN Sitemaps (Sitemaps 6 & 7 recent publications)
      console.log('  -> Scanning CRDCN recent publication sitemaps...');
      try {
        const crdcn = await harvestCrdcnPublications({
          sitemapIndices: [6, 7],
          minYear,
          maxRecords: 150,
          queue: q,
        });
        rawCandidates.push(...crdcn);
        report.harvest.crdcn = crdcn.length;
        console.log(`     ✓ CRDCN: ${crdcn.length} recent candidate works.`);
      } catch {
        console.log('     ⚠ CRDCN recent sitemap check timed out or skipped.');
      }

      // 1c. Scholaris Consortium Theses
      console.log('  -> Scanning Canadian University Institutional Repositories...');
      try {
        const theses = await harvestAllScholarisTheses({
          queue: q,
          minYear,
          maxPagesPerQuery: 1, // Quick incremental scan
        });
        rawCandidates.push(...theses);
        report.harvest.scholarisTheses = theses.length;
        console.log(`     ✓ Scholaris Theses: ${theses.length} candidate works.`);
      } catch {
        console.log('     ⚠ Scholaris scan skipped or timed out.');
      }

      // 1d. Canadian Public Health Surveillance
      console.log('  -> Scanning Public Health Authorities (PHO, INSPQ, BCCDC, AHS)...');
      try {
        const health = await harvestAllHealthAuthorities({
          queue: q,
          minYear,
        });
        rawCandidates.push(...health);
        report.harvest.publicHealth = health.length;
        console.log(`     ✓ Public Health: ${health.length} candidate works.`);
      } catch {
        console.log('     ⚠ Public Health scan skipped or timed out.');
      }

      report.harvest.totalRawCandidates = rawCandidates.length;
      console.log(`\n  Total fresh raw candidate works gathered: ${rawCandidates.length}`);
    } else {
      console.log('[Stage 1/6] Skipping fresh harvesting as requested.');
    }

    // ── STAGE 2: Deduplication & Seeding ────────────────────────────────────
    console.log('\n[Stage 2/6] Deduplicating and seeding candidate works into queue...');
    const uniqueSources = assembleCandidates(rawCandidates);
    report.harvest.uniqueSources = uniqueSources.length;
    console.log(`  ✓ Assembled ${uniqueSources.length} unique source works.`);

    let seeded = 0;
    for (const s of uniqueSources) {
      seeded += q.seed(s, 'deterministic');
    }
    report.harvest.jobsSeeded = seeded;
    console.log(`  ✓ Seeded ${seeded} new extraction jobs into SQLite queue.`);

    // ── STAGE 3: Deterministic & Local LLM Disambiguation ───────────────────
    console.log('\n[Stage 3/6] Running deterministic extraction with Canadian grounding...');
    const reprocessRes = q.reprocessDeterministic();
    report.enrichment.deterministicReprocessed = reprocessRes.reprocessed;
    report.enrichment.claimsUpdated = reprocessRes.claimsUpdated;
    console.log(`  ✓ Reprocessed ${reprocessRes.reprocessed} jobs, ${reprocessRes.claimsUpdated} claims updated.`);

    if (!options.skipLlm) {
      console.log('\n[Stage 3b/6] Checking Local LLM fleet for precision cycle & attribution resolution...');
      const llmReachable = await isPortReachable(localLlmUrl);
      if (llmReachable) {
        console.log(`  ✓ LM Studio active on ${localLlmUrl} (using ${localLlmModel}).`);
        const llmRes = await runLocalLlmEnrichmentPass(q, {
          limit: options.llmLimit ?? 50,
          endpoint: localLlmUrl,
          model: localLlmModel,
        });
        report.enrichment.llmDisambiguated = llmRes.llmDisambiguated;
        report.enrichment.programOnlyResolved = llmRes.programOnlyResolved;
        report.enrichment.provisionalElevated = llmRes.provisionalElevated;
      } else {
        console.log(`  ℹ LM Studio not running on ${localLlmUrl}; skipping LLM pass for tonight.`);
      }
    }

    // ── STAGE 4: Zero-Hallucination Quote Gate ──────────────────────────────
    console.log('\n[Stage 4/6] Executing Zero-Hallucination Verbatim Quote Audit Gate...');
    const audit = q.audit();
    report.audit.totalJobs = audit.jobs;
    report.audit.flaggedClaims = audit.flaggedClaims;

    console.log(`  ✓ Total Audit Jobs: ${audit.jobs}`);
    console.log(`  ✓ Flagged Claims: ${audit.flaggedClaims}`);

    if (audit.flaggedClaims > 0) {
      report.audit.gatePassed = false;
      console.error(`\n❌ Gate Failed: ${audit.flaggedClaims} ungrounded claims detected! Halting without publication.`);
      throw new Error(`Zero-Hallucination Audit Failed: ${audit.flaggedClaims} flagged claims!`);
    }

    report.audit.gatePassed = true;
    console.log('  ✓ Audit Gate PASSED: 0 flagged claims.');

    // ── STAGE 5: Catalogue Export & Build Verification ──────────────────────
    console.log('\n[Stage 5/6] Exporting public catalogue preview...');
    const reviewed = q.exportReviewed();
    const publicWorks = publicPreview(reviewed, 2015);

    const verifiedCount = publicWorks.filter(w => w.uses.some(u => u.certainty === 'verified')).length;
    const provisionalCount = publicWorks.filter(w => w.uses.some(u => u.certainty === 'provisional')).length;

    report.catalogue.totalPublicWorks = publicWorks.length;
    report.catalogue.verifiedCount = verifiedCount;
    report.catalogue.provisionalCount = provisionalCount;
    report.catalogue.verifiedPercentage = `${((verifiedCount / publicWorks.length) * 100).toFixed(1)}%`;

    if (!options.dryRun) {
      fs.writeFileSync(previewFile, JSON.stringify(publicWorks, null, 2) + '\n', 'utf8');
      console.log(`  ✓ Updated ${previewFile} with ${publicWorks.length} public works.`);
    }

    console.log(`  ✓ Public Catalogue Metrics:`);
    console.log(`    - Total Public Works: ${publicWorks.length}`);
    console.log(`    - Verified StatCan Analyses: ${verifiedCount} (${report.catalogue.verifiedPercentage})`);
    console.log(`    - Provisional Canadian Claims: ${provisionalCount}`);

    console.log('\n[Build Gate] Running Hub production build verification...');
    execSync('pnpm --filter @mobilesurvey/hub build', { cwd: PROJECT_ROOT, stdio: 'inherit' });
    console.log('  ✓ Production bundle built cleanly.');

    // ── STAGE 6: Git Commit & Deploy ────────────────────────────────────────
    if (options.deploy && !options.dryRun) {
      console.log('\n[Stage 6/6] Checking for git changes to commit and deploy...');
      const diffOutput = execSync('git status --porcelain platform/hub/src/researcherPilot.json', {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
      });

      if (diffOutput.trim()) {
        console.log('  -> Changes detected in researcherPilot.json; committing and pushing...');
        execSync('git add platform/hub/src/researcherPilot.json tools/research/researcher', {
          cwd: PROJECT_ROOT,
          stdio: 'inherit',
        });
        const commitMsg = `feat(researcher): nightly enrichment (${publicWorks.length} works, ${verifiedCount} verified, 0 quote flags)`;
        execSync(`git commit -m "${commitMsg}"`, { cwd: PROJECT_ROOT, stdio: 'inherit' });
        execSync('git push origin main', { cwd: PROJECT_ROOT, stdio: 'inherit' });

        const headHash = execSync('git rev-parse --short HEAD', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
        report.deployment.committed = true;
        report.deployment.pushed = true;
        report.deployment.commitHash = headHash;
        console.log(`  ✓ Successfully committed and pushed to origin/main (${headHash})!`);
      } else {
        console.log('  -> No changes in public catalogue tonight; git state is already clean.');
      }
    }

    report.durationMs = Date.now() - startTime;
    console.log(`\n✓ Nightly Enrichment finished in ${(report.durationMs / 1000).toFixed(1)}s.`);

    // Write nightly run log
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
    }
    const reportPath = path.join(runsDir, `${timestamp.slice(0, 10)}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(`✓ Telemetry report recorded at ${reportPath}`);

    return report;
  } finally {
    q.close();
  }
}

// CLI Execution Entry Point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const deploy = process.argv.includes('--deploy');
  const dryRun = process.argv.includes('--dry-run');
  const skipHarvest = process.argv.includes('--skip-harvest');
  const skipLlm = process.argv.includes('--skip-llm');
  const llmLimitArg = process.argv.find(a => a.startsWith('--llm-limit='));
  const llmLimit = llmLimitArg ? parseInt(llmLimitArg.split('=')[1]!, 10) : 50;

  runNightlyEnrichment({
    deploy,
    dryRun,
    skipHarvest,
    skipLlm,
    llmLimit,
  })
    .then(report => {
      console.log('\n[Nightly Enrichment Report]:', JSON.stringify(report, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('\n[Nightly Enrichment Fatal Error]:', err);
      process.exit(1);
    });
}
