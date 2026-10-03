import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { parseOpenAlexWork } from './adapters/openalex.js';
import { assembleCandidates } from './adapters/discovery.js';
import { CANONICAL_SURVEYS, type CandidateWork } from './model.js';
import { ResearchQueue } from './queue.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const dbPath = path.join(ROOT, 'out', 'researcher.db');

async function main() {
  const db = new DatabaseSync(dbPath);
  const rows = db.prepare("SELECT url, response_body FROM adapter_checkpoint WHERE adapter='OpenAlex'").all() as Array<{
    url: string;
    response_body: string;
  }>;

  console.log(`Processing ${rows.length} cached OpenAlex responses...`);
  const candidates: CandidateWork[] = [];

  for (const row of rows) {
    try {
      const data = JSON.parse(row.response_body);
      if (!Array.isArray(data.results)) continue;
      const urlObj = new URL(row.url);
      const searchParam = decodeURIComponent(urlObj.searchParams.get('search') ?? '');

      // Identify program from searchParam or survey definitions
      let matchedProgram: string | undefined;
      for (const [key, spec] of Object.entries(CANONICAL_SURVEYS)) {
        if (spec.aliases.some(a => searchParam.toLowerCase().includes(a.toLowerCase())) ||
            searchParam.toLowerCase().includes(spec.name.toLowerCase())) {
          matchedProgram = key;
          break;
        }
      }

      for (const raw of data.results) {
        const c = parseOpenAlexWork(raw);
        if (matchedProgram) {
          c.suggestedPrograms = [...new Set([...(c.suggestedPrograms ?? []), matchedProgram])];
        }
        candidates.push(c);
      }
    } catch (e) {
      console.error(`Error parsing row ${row.url}:`, e);
    }
  }

  console.log(`Parsed ${candidates.length} raw candidates.`);
  const candidatesFile = path.join(ROOT, 'out', 'candidates-full-2025-2026.jsonl');
  fs.writeFileSync(candidatesFile, candidates.map(c => JSON.stringify(c)).join('\n') + '\n', 'utf8');

  // Assemble and deduplicate
  const sources = assembleCandidates(candidates);
  console.log(`Assembled ${sources.length} unique sources.`);
  const sourcesFile = path.join(ROOT, 'out', 'sources-full-2025-2026.jsonl');
  fs.writeFileSync(sourcesFile, sources.map(s => JSON.stringify(s)).join('\n') + '\n', 'utf8');

  // Seed into ResearchQueue
  const q = new ResearchQueue(dbPath);
  let seeded = 0;
  for (const s of sources) {
    seeded += q.seed(s, 'qwen3.8-27b');
  }
  console.log(`Seeded ${seeded} new/updated jobs into queue.`);

  // Reprocess deterministic extraction
  console.log('Reprocessing deterministic extraction...');
  const res = q.reprocessDeterministic();
  console.log(`Reprocessed: ${res.reprocessed} jobs, ${res.claimsUpdated} claims.`);

  // Audit
  const auditRes = q.audit();
  console.log('Audit result:', JSON.stringify(auditRes));

  // Export reviewed and preview
  const reviewed = q.exportReviewed();
  const reviewedFile = path.join(ROOT, 'out', 'reviewed.jsonl');
  fs.writeFileSync(reviewedFile, reviewed.map(r => JSON.stringify(r)).join('\n') + (reviewed.length ? '\n' : ''), 'utf8');
  console.log(`Exported ${reviewed.length} reviewed works to ${reviewedFile}`);

  // Preview
  const { publicPreview } = await import('./public-preview.js');
  const preview = publicPreview(reviewed);
  const previewFile = path.resolve(ROOT, '../../../platform/hub/src/researcherPilot.json');
  fs.writeFileSync(previewFile, JSON.stringify(preview, null, 2) + '\n', 'utf8');
  console.log(`Generated public preview with ${preview.length} works at ${previewFile}`);

  q.close();
}

main().catch(console.error);
