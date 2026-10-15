import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { ResearchQueue } from './queue.js';
import { harvestPanCanadianJurisdictions } from './adapters/pan_canadian_harvester.js';
import { harvestCrdcnPublications } from './adapters/crdcn.js';
import { assembleCandidates } from './adapters/discovery.js';
import { publicPreview } from './public-preview.js';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PROJECT_ROOT = path.resolve(ROOT, '../../..');
const dbPath = path.join(ROOT, 'out', 'researcher.db');
const previewFile = path.resolve(PROJECT_ROOT, 'platform/hub/src/researcherPilot.json');

export interface ScheduledRunResult {
  policyCandidates: number;
  uniqueSources: number;
  jobsSeeded: number;
  flaggedClaims: number;
  publicWorksCount: number;
  verifiedCount: number;
  provisionalCount: number;
  status: 'clean_deployed' | 'clean_staged' | 'audit_failed';
}

/**
 * Runs the automated scheduled policy and grey literature crawler.
 * Ingests municipal, provincial, federal department and NGO reports,
 * processes them deterministically with zero-hallucination quote checks,
 * labels certainty markers, and deploys if clean.
 */
export async function runScheduledPolicyCrawler(options: {
  deploy?: boolean;
}): Promise<ScheduledRunResult> {
  console.log('\n======================================================');
  console.log('[Scheduled Policy Crawler] Starting Multi-Jurisdictional Crawl');
  console.log(`[Time] ${new Date().toISOString()}`);
  console.log('======================================================\n');

  const q = new ResearchQueue(dbPath);

  try {
    // 1. Harvest Pan-Canadian sources (Federal, Provincial, CMA, NGO)
    console.log('[Step 1/5] Harvesting Pan-Canadian Jurisdictions (Federal, Provincial, CMA, NGO)...');
    const candidates = await harvestPanCanadianJurisdictions();
    console.log(`  ✓ Collected ${candidates.length} candidate reports and data packages.`);

    // 1b. Harvest CRDCN recent publications
    console.log('\n[Step 1b/5] Harvesting CRDCN recent publications (Sitemaps 6 & 7)...');
    try {
      const crdcnCandidates = await harvestCrdcnPublications({ sitemapIndices: [6, 7], minYear: 2015, maxRecords: 200, queue: q });
      candidates.push(...crdcnCandidates);
      console.log(`  ✓ Collected ${crdcnCandidates.length} CRDCN candidate works.`);
    } catch {
      console.log('  ⚠ CRDCN recent harvest skipped or timed out.');
    }

    // 2. Assemble and Deduplicate
    console.log('\n[Step 2/5] Deduplicating and validating Canadian jurisdiction...');
    const sources = assembleCandidates(candidates);
    console.log(`  ✓ Formed ${sources.length} unique deduplicated source works.`);

    let jobsSeeded = 0;
    for (const s of sources) {
      jobsSeeded += q.seed(s, 'deterministic');
    }
    console.log(`  ✓ Seeded ${jobsSeeded} extraction jobs into SQLite queue.`);

    // 3. Reprocess deterministic with certainty markers
    console.log('\n[Step 3/5] Extracting claims with certainty & attribution markers...');
    const reprocessRes = q.reprocessDeterministic();
    console.log(`  ✓ Reprocessed ${reprocessRes.reprocessed} jobs, ${reprocessRes.claimsUpdated} claims updated.`);

    // 4. Zero-hallucination audit gate
    console.log('\n[Step 4/5] Running zero-hallucination verbatim quote audit...');
    const audit = q.audit();
    console.log(`  ✓ Total Audit Jobs: ${audit.jobs}`);
    console.log(`  ✓ Flagged Claims: ${audit.flaggedClaims}`);

    if (audit.flaggedClaims > 0) {
      console.error(`\n❌ Gate Failed: ${audit.flaggedClaims} ungrounded claims detected!`);
      q.close();
      return {
        policyCandidates: candidates.length,
        uniqueSources: sources.length,
        jobsSeeded,
        flaggedClaims: audit.flaggedClaims,
        publicWorksCount: 0,
        verifiedCount: 0,
        provisionalCount: 0,
        status: 'audit_failed',
      };
    }

    // 5. Export public preview
    console.log('\n[Step 5/5] Exporting reviewed facts to public preview catalogue...');
    const reviewed = q.exportReviewed();
    const publicWorks = publicPreview(reviewed, 2015);

    const verifiedCount = publicWorks.filter(w => w.uses.some(u => u.certainty === 'verified')).length;
    const provisionalCount = publicWorks.filter(w => w.uses.some(u => u.certainty === 'provisional')).length;

    fs.writeFileSync(previewFile, JSON.stringify(publicWorks, null, 2) + '\n', 'utf8');
    console.log(`  ✓ Updated ${previewFile}`);
    console.log(`  ✓ Total Public Works: ${publicWorks.length}`);
    console.log(`    - With Verified StatCan Claims: ${verifiedCount}`);
    console.log(`    - With Provisional Canadian Context Claims: ${provisionalCount}`);

    // Build verification
    console.log('\n[Build Gate] Running typecheck and Hub build verification...');
    execSync('pnpm --filter @mobilesurvey/hub typecheck', { cwd: PROJECT_ROOT, stdio: 'inherit' });
    execSync('pnpm --filter @mobilesurvey/hub build', { cwd: PROJECT_ROOT, stdio: 'inherit' });
    console.log('  ✓ Typecheck and build passed cleanly.');

    if (options.deploy) {
      console.log('\n[Deploy Gate] Committing and pushing updates to main...');
      execSync('git add platform/hub/src/researcherPilot.json tools/research/researcher', { cwd: PROJECT_ROOT, stdio: 'inherit' });
      execSync(`git commit -m "feat(researcher): scheduled policy crawl (${publicWorks.length} works, ${verifiedCount} verified, ${provisionalCount} provisional)"`, { cwd: PROJECT_ROOT, stdio: 'inherit' });
      execSync('git push origin main', { cwd: PROJECT_ROOT, stdio: 'inherit' });
      console.log('  ✓ Deployed cleanly to origin/main!');
    }

    q.close();
    return {
      policyCandidates: candidates.length,
      uniqueSources: sources.length,
      jobsSeeded,
      flaggedClaims: 0,
      publicWorksCount: publicWorks.length,
      verifiedCount,
      provisionalCount,
      status: options.deploy ? 'clean_deployed' : 'clean_staged',
    };
  } catch (err) {
    q.close();
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const shouldDeploy = process.argv.includes('--deploy');
  runScheduledPolicyCrawler({ deploy: shouldDeploy })
    .then(res => {
      console.log('\n[Scheduled Crawler] Finished successfully:', res);
      process.exit(0);
    })
    .catch(err => {
      console.error('\n[Scheduled Crawler] Failed:', err);
      process.exit(1);
    });
}
