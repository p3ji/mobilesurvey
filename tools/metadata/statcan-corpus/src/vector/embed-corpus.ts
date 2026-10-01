import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from '@xenova/transformers';
import { fetchVectorRoles } from './roles.js';

// 1. Environment discovery
const candidatePaths = [
  resolve(import.meta.dirname, '../../.env'),
  resolve(import.meta.dirname, '../../.env.local'),
  resolve(import.meta.dirname, '../../../../../platform/hub/.env.local'),
  resolve(import.meta.dirname, '../../../../../platform/hub/.env'),
  resolve(import.meta.dirname, '../../../../../.env'),
];

for (const envPath of candidatePaths) {
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) {
          const key = trimmed.slice(0, eq).trim();
          const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
          if (key && val && !process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    } catch {}
  }
}

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)?.replace(/\/+$/, '');
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const qdrantUrl = (process.env.QDRANT_URL || process.env.QDRANT_ENDPOINT || process.env.CLUSTER_URL)?.replace(/\/+$/, '');
const qdrantApiKey = process.env.QDRANT_API_KEY;
const collectionName = process.env.QDRANT_COLLECTION ?? 'modularsurvey';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Error: Supabase credentials not found in environment.');
  process.exit(1);
}

if (!qdrantUrl || !qdrantApiKey) {
  console.error('Error: Qdrant credentials not found in environment.');
  process.exit(1);
}

interface RawVariableRow {
  record_id: string;
  name: string;
  concept: string | null;
  question_text: string | null;
  note: string | null;
  code_count: number | null;
  survey_group: string;
  year: number | null;
  lang: string;
}

interface SubjectRow {
  survey_group: string;
  subject: string;
}

async function fetchSubjectMap(): Promise<Map<string, string[]>> {
  const res = await fetch(`${supabaseUrl}/rest/v1/corpus_survey_subject?select=survey_group,subject`, {
    headers: {
      apikey: supabaseAnonKey!,
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
  });
  if (!res.ok) {
    console.warn('Failed to load subject mapping; defaulting to empty subjects.');
    return new Map();
  }
  const rows = (await res.json()) as SubjectRow[];
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.survey_group) ?? [];
    list.push(r.subject);
    map.set(r.survey_group, list);
  }
  return map;
}

// Canonical text to embed
function prepareSemanticText(row: RawVariableRow): string {
  const parts: string[] = [];

  if (row.concept && row.concept.trim().length > 3) {
    parts.push(row.concept.trim());
  }

  if (row.question_text && row.question_text.trim().length > 3) {
    const qText = row.question_text.trim();
    if (!parts.some((p) => p.toLowerCase() === qText.toLowerCase())) {
      parts.push(`Question: ${qText}`);
    }
  }

  return parts.join(' | ');
}

async function main() {
  console.log(`\n======================================================`);
  console.log(`  Full Corpus Vector Ingestion`);
  console.log(`  Target: "${collectionName}" @ Qdrant Cloud`);
  console.log(`======================================================\n`);

  console.log('1. Loading subject mappings...');
  const subjectMap = await fetchSubjectMap();
  console.log(`Loaded subject mappings for ${subjectMap.size} survey groups.`);

  console.log('2. Initializing on-device embedding model (Xenova/all-MiniLM-L6-v2)...');
  const tModel0 = performance.now();
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log(`Embedding model ready in ${Math.round(performance.now() - tModel0)}ms (384 dimensions, Cosine metric).`);

  console.log('3. Streaming English corpus via keyset pagination...');
  const BATCH_SIZE = 1000;
  const UPSERT_BATCH = 200;
  let totalScanned = 0;
  let totalEligible = 0;
  let totalUpserted = 0;
  const embeddingCache = new Map<string, number[]>();

  let lastRecordId: string | null = null;
  let hasMore = true;
  let batchIndex = 0;

  const pointsBuffer: Array<{
    id: string;
    vector: number[];
    payload: {
      record_id: string;
      survey_group: string;
      year: number;
      subject: string[];
      role: string;
      lang: string;
      has_codes: boolean;
    };
  }> = [];

  const tStart = performance.now();

  while (hasMore) {
    batchIndex++;
    const filterQuery = lastRecordId
      ? `lang=eq.en&record_id=gt.${lastRecordId}&order=record_id.asc&limit=${BATCH_SIZE}`
      : `lang=eq.en&order=record_id.asc&limit=${BATCH_SIZE}`;

    const url = `${supabaseUrl}/rest/v1/corpus_variable?select=record_id,name,concept,question_text,note,code_count,survey_group,year,lang&${filterQuery}`;
    const res = await fetch(url, {
      headers: {
        apikey: supabaseAnonKey!,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
    });

    if (!res.ok) {
      console.error(`Failed to fetch chunk at record_id > ${lastRecordId}: ${await res.text()}`);
      break;
    }

    const rows = (await res.json()) as RawVariableRow[];
    if (rows.length === 0) {
      hasMore = false;
      break;
    }

    lastRecordId = rows[rows.length - 1]!.record_id;
    totalScanned += rows.length;
    const eligible = rows.filter((row) =>
      (row.concept?.trim().length ?? 0) >= 5 || (row.question_text?.trim().length ?? 0) >= 5,
    );
    const roles = await fetchVectorRoles(supabaseUrl!, supabaseAnonKey!, eligible.map((row) => row.record_id));

    for (const row of eligible) {
      totalEligible++;
      const text = prepareSemanticText(row);
      if (!text || text.length < 5) continue;

      let vec = embeddingCache.get(text);
      if (!vec) {
        const out = await extractor(text, { pooling: 'mean', normalize: true });
        vec = Array.from(out.data as Float32Array);
        embeddingCache.set(text, vec);
      }

      const role = roles.get(row.record_id)!;
      const subjects = subjectMap.get(row.survey_group) ?? [];

      pointsBuffer.push({
        id: row.record_id,
        vector: vec,
        payload: {
          record_id: row.record_id,
          survey_group: row.survey_group,
          year: row.year ?? 0,
          subject: subjects,
          role,
          lang: 'en',
          has_codes: (row.code_count ?? 0) > 0,
        },
      });

      if (pointsBuffer.length >= UPSERT_BATCH) {
        await upsertToQdrant(pointsBuffer.splice(0, pointsBuffer.length));
        totalUpserted += UPSERT_BATCH;
      }
    }

    const elapsedSec = Math.round((performance.now() - tStart) / 1000);
    const rate = Math.round(totalScanned / (elapsedSec || 1));
    process.stdout.write(`\r[Batch ${batchIndex}] Scanned: ${totalScanned.toLocaleString()} | Eligible: ${totalEligible.toLocaleString()} | Upserted: ${totalUpserted.toLocaleString()} | Cached: ${embeddingCache.size.toLocaleString()} (${rate} rows/s)`);

    if (rows.length < BATCH_SIZE) {
      hasMore = false;
    }
  }

  // Flush remaining buffer
  if (pointsBuffer.length > 0) {
    const rem = pointsBuffer.length;
    await upsertToQdrant(pointsBuffer);
    totalUpserted += rem;
  }

  const totalTimeSec = Math.round((performance.now() - tStart) / 1000);

  console.log(`\n\n======================================================`);
  console.log(`  Full Corpus Ingestion Complete!`);
  console.log(`  Total Execution Time: ${totalTimeSec} seconds`);
  console.log(`  Total Variables Scanned: ${totalScanned.toLocaleString()} / 194,507`);
  console.log(`  Total Substantive Variables Embedded: ${totalEligible.toLocaleString()}`);
  console.log(`  Unique Embeddings Cached: ${embeddingCache.size.toLocaleString()} (~${Math.round((1 - embeddingCache.size / totalEligible) * 100)}% deduplication)`);
  console.log(`  Total Points in Qdrant: ${totalUpserted.toLocaleString()}`);
  console.log(`======================================================\n`);
}

async function upsertToQdrant(points: any[]): Promise<void> {
  const res = await fetch(`${qdrantUrl}/collections/${collectionName}/points`, {
    method: 'PUT',
    headers: {
      'api-key': qdrantApiKey!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ points }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Qdrant upsert failed [${res.status}]: ${text}`);
  }
}

main().catch(console.error);
