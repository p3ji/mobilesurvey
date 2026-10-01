import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const candidatePaths = [
  resolve(import.meta.dirname, '../../.env'),
  resolve(import.meta.dirname, '../../../../.env'),
  resolve(import.meta.dirname, '../../../../platform/hub/.env.local'),
  resolve(import.meta.dirname, '../../../../platform/hub/.env'),
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

const resolvedUrl = (process.env.QDRANT_URL || process.env.QDRANT_ENDPOINT || process.env.CLUSTER_URL)?.replace(/\/+$/, '');
const apiKey = process.env.QDRANT_API_KEY;
const collectionName = process.env.QDRANT_COLLECTION ?? 'modularsurvey';

if (!resolvedUrl || !apiKey) {
  console.error('Error: Both QDRANT_URL and QDRANT_API_KEY must be set in .env');
  process.exit(1);
}

const headers: Record<string, string> = {
  'api-key': apiKey,
  'Content-Type': 'application/json',
};

async function qdrantRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${resolvedUrl}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  const body = await response.json().catch(() => ({})) as { result?: T; status?: string; time?: number; error?: string };
  if (!response.ok) {
    throw new Error(`Qdrant API error [${response.status} ${response.statusText}]: ${body.error ?? JSON.stringify(body)}`);
  }
  return body.result as T;
}

// Exactly the 6 filter fields defined in the hybrid architecture specification
const HYBRID_SPEC_INDEXES: Record<string, 'keyword' | 'integer' | 'bool'> = {
  survey_group: 'keyword',
  year: 'integer',
  subject: 'keyword',
  role: 'keyword',
  lang: 'keyword',
  has_codes: 'bool',
};

async function main() {
  console.log(`Aligning collection "${collectionName}" with Hybrid Architecture spec...`);

  const info = await qdrantRequest<{ payload_schema?: Record<string, { data_type: string }> }>(
    `/collections/${collectionName}`
  );
  const existing = info.payload_schema ?? {};

  // 1. Remove extraneous indexes not in the 6-field spec
  for (const field of Object.keys(existing)) {
    if (!HYBRID_SPEC_INDEXES[field]) {
      console.log(`- Removing extraneous index: "${field}"`);
      await qdrantRequest(`/collections/${collectionName}/index/${field}`, { method: 'DELETE' });
    }
  }

  // 2. Ensure all 6 required fields are indexed
  for (const [field, schema] of Object.entries(HYBRID_SPEC_INDEXES)) {
    if (!existing[field]) {
      console.log(`+ Creating required index: "${field}" (${schema})`);
      await qdrantRequest(`/collections/${collectionName}/index`, {
        method: 'PUT',
        body: JSON.stringify({ field_name: field, field_schema: schema }),
      });
    } else {
      console.log(`✓ Required index present: "${field}" (${schema})`);
    }
  }

  const updated = await qdrantRequest<{ payload_schema?: Record<string, { data_type: string }> }>(
    `/collections/${collectionName}`
  );
  console.log('\nFinal active payload indexes:', Object.keys(updated.payload_schema ?? {}));
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
