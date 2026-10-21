import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResearchQueue } from './queue.js';
import { harvestAllScholarisTheses } from './adapters/institutional_repositories.js';
import { assembleCandidates } from './adapters/discovery.js';
import { publicPreview } from './public-preview.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const dbPath = path.join(ROOT, 'out', 'researcher.db');
const previewFile = path.resolve(ROOT, '../../../platform/hub/src/researcherPilot.json');

export async function runInstitutionalThesesHarvest() {
  const q = new ResearchQueue(dbPath);
  console.log(`\n================================================================`);
  console.log(`[Work Stream 3] Canadian University Theses & Institutional Repositories`);
  console.log(`Harvesting from U15/Scholaris Repositories across 9 Canadian Universities`);
  console.log(`================================================================\n`);

  // Step 1: Harvest all theses and graduate research papers
  const candidates = await harvestAllScholarisTheses({
    queue: q,
    maxPagesPerQuery: 3,
    minYear: 2015,
  });

  console.log(`\n[Harvest Complete] Total raw thesis candidates retrieved: ${candidates.length}`);

  // Step 2: Assemble and deduplicate candidate works
  const sources = assembleCandidates(candidates);
  console.log(`[Deduplication] Assembled ${sources.length} unique source works from universities.`);

  // Step 3: Seed into queue
  let seeded = 0;
  for (const s of sources) {
    seeded += q.seed(s, 'deterministic');
  }
  console.log(`[Queue Seeding] Seeded ${seeded} extraction jobs into researcher.db.`);

  // Step 4: Reprocess deterministic extractions
  console.log('[Deterministic Extraction] Running deterministic extraction with Canadian grounding & cycle validation...');
  const res = q.reprocessDeterministic();
  console.log(`[Deterministic Extraction Complete] ${res.reprocessed} jobs, ${res.claimsUpdated} claims updated.`);

  // Step 5: Audit quote fidelity (Zero Hallucination Contract)
  const audit = q.audit();
  console.log('[Queue Audit - Zero Hallucination Check]:', JSON.stringify(audit));
  if (audit.flaggedClaims > 0) {
    throw new Error(`Audit failed: ${audit.flaggedClaims} flagged claims detected!`);
  }

  // Step 6: Export reviewed works and update public pilot
  const reviewed = q.exportReviewed();
  console.log(`[Catalogue Export] Total reviewed works across all periods: ${reviewed.length}`);

  const publicWorks = publicPreview(reviewed, 2015);
  console.log(`[Catalogue Export] Active 2015+ works for site: ${publicWorks.length}`);

  // Step 7: Write out snapshot to Hub
  fs.writeFileSync(previewFile, JSON.stringify(publicWorks, null, 2) + '\n');
  console.log(`[Snapshot Written] Updated ${previewFile} with ${publicWorks.length} public works.`);

  // Print certainty distribution
  let verified = 0;
  let provisional = 0;
  for (const w of publicWorks) {
    if (w.uses.some(u => u.certainty === 'verified')) verified++;
    else provisional++;
  }
  console.log(`\nAttribution Certainty Summary:`);
  console.log(`  ✓ Verified StatCan: ${verified} (${((verified / publicWorks.length) * 100).toFixed(1)}%)`);
  console.log(`  ⏳ Provisional:      ${provisional} (${((provisional / publicWorks.length) * 100).toFixed(1)}%)`);

  q.close();
  console.log(`\n✓ Work Stream 3: Institutional Theses Harvest Successfully Finished.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runInstitutionalThesesHarvest().catch(err => {
    console.error('Fatal error in institutional theses harvest:', err);
    process.exit(1);
  });
}
