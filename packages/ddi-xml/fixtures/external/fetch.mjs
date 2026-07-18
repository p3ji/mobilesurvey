/**
 * Fetch ddigraph's real-world DDI-Lifecycle demo files (Ireland Labour Force Survey,
 * production scale, ~14.5 MB total) for the on-demand external-import tests
 * (docs/ddi-compliance-plan.md §3.6 / P4).
 *
 * The files live in ddigraph's repo under Git LFS, so raw.githubusercontent.com serves
 * only LFS pointers — media.githubusercontent.com serves the actual content.
 * They are NOT committed here (see .gitignore); run this script to (re)download:
 *
 *   node packages/ddi-xml/fixtures/external/fetch.mjs
 */
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://media.githubusercontent.com/media/pbisson44/ddigraph/main/demo';
const FILES = ['LFS.xml', 'Ireland_LabourSurvey.xml', 'Ireland_LFS_Series.xml'];

for (const name of FILES) {
  const dest = path.join(HERE, name);
  if (existsSync(dest) && statSync(dest).size > 1024) {
    console.log(`skip ${name} (already present, ${(statSync(dest).size / 1e6).toFixed(1)} MB)`);
    continue;
  }
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok || !res.body) throw new Error(`${name}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(`fetched ${name} (${(statSync(dest).size / 1e6).toFixed(1)} MB)`);
}
