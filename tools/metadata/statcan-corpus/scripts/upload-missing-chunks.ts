/**
 * Upload missing document chunks from `out/documents/` to Supabase Storage bucket `corpus-documents`.
 *
 * Usage:
 *   npx tsx scripts/upload-missing-chunks.ts [--dry-run] [--concurrency 5]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { credentialsFromEnv, envWithFile, uploadObject, DOCUMENTS_BUCKET } from '../src/load.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'out', 'documents');

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const concurrencyIndex = args.indexOf('--concurrency');
  const concurrency = concurrencyIndex !== -1 ? parseInt(args[concurrencyIndex + 1], 10) : 5;

  const creds = credentialsFromEnv(envWithFile(path.join(ROOT, '.env.local')));
  console.log(`Target: ${creds.url}`);
  console.log(`Bucket: ${DOCUMENTS_BUCKET}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Concurrency: ${concurrency}`);

  // Load the precomputed missing chunks list or compute on the fly
  let missingChunks: string[] = [];
  const precomputedPath = '/tmp/missing_storage_chunks.json';

  if (existsSync(precomputedPath)) {
    console.log(`Loading precomputed missing chunks from ${precomputedPath}...`);
    missingChunks = JSON.parse(readFileSync(precomputedPath, 'utf8'));
  } else {
    console.log('Querying existing objects in storage bucket...');
    // Fallback: fetch list or check chunks
    throw new Error('Please ensure /tmp/missing_storage_chunks.json exists with the missing keys.');
  }

  console.log(`Found ${missingChunks.length} missing chunks to upload.`);

  if (dryRun) {
    console.log('Sample missing chunks:', missingChunks.slice(0, 10));
    return;
  }

  let uploaded = 0;
  let failed = 0;
  const total = missingChunks.length;
  const started = Date.now();

  async function uploadWorker(chunkKey: string): Promise<void> {
    const [docId, fileName] = chunkKey.split('/');
    const filePath = path.join(DOCS_DIR, docId, fileName);
    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      failed += 1;
      return;
    }
    const body = readFileSync(filePath, 'utf8');
    try {
      await uploadObject(creds, DOCUMENTS_BUCKET, chunkKey, body);
      uploaded += 1;
    } catch (err) {
      failed += 1;
      console.error(`Failed to upload ${chunkKey}:`, (err as Error).message);
    }
    if ((uploaded + failed) % 10 === 0 || uploaded + failed === total) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`Progress: ${uploaded + failed}/${total} chunks (${uploaded} uploaded, ${failed} failed) [${elapsed}s]`);
    }
  }

  // Run pool with concurrency limit
  let index = 0;
  async function next(): Promise<void> {
    while (index < missingChunks.length) {
      const current = missingChunks[index++];
      await uploadWorker(current);
    }
  }

  const pool = Array.from({ length: concurrency }, () => next());
  await Promise.all(pool);

  const duration = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Done in ${duration}s. Successfully uploaded: ${uploaded}, Failed: ${failed}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
