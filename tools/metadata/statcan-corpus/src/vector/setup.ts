import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env from statcan-corpus directory or root
const candidatePaths = [
  resolve(import.meta.dirname, '../../.env'),
  resolve(import.meta.dirname, '../../../../.env'),
  resolve(import.meta.dirname, '../../../../platform/hub/.env.local'),
  resolve(import.meta.dirname, '../../../../platform/hub/.env'),
];

let loadedFrom: string | null = null;
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
            loadedFrom = envPath;
          }
        }
      }
    } catch {}
  }
}

if (loadedFrom) {
  console.log(`Loaded configuration from: ${loadedFrom}`);
}

const resolvedUrl = (process.env.QDRANT_URL || process.env.QDRANT_ENDPOINT || process.env.CLUSTER_URL)?.replace(/\/+$/, '');
const apiKey = process.env.QDRANT_API_KEY;
const collectionName = process.env.QDRANT_COLLECTION ?? 'modularsurvey';

if (!resolvedUrl || !apiKey) {
  console.error('Error: Both QDRANT_URL and QDRANT_API_KEY must be set in tools/metadata/statcan-corpus/.env');
  process.exit(1);
}

const qdrantUrl = resolvedUrl;

const headers: Record<string, string> = {
  'api-key': apiKey,
  'Content-Type': 'application/json',
};

async function qdrantRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${qdrantUrl}${endpoint}`;
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

interface CollectionInfo {
  status: string;
  vectors_count?: number;
  points_count?: number;
  segments_count?: number;
  config?: {
    params?: {
      vectors?: {
        size?: number;
        distance?: string;
      };
    };
    quantization_config?: unknown;
  };
  payload_schema?: Record<string, { data_type: string }>;
}

const PAYLOAD_INDEXES: Array<{ field_name: string; field_schema: 'keyword' | 'integer' | 'bool' }> = [
  { field_name: 'survey_group', field_schema: 'keyword' },
  { field_name: 'survey_acronym', field_schema: 'keyword' },
  { field_name: 'cycle', field_schema: 'keyword' },
  { field_name: 'year', field_schema: 'integer' },
  { field_name: 'gsim_role', field_schema: 'keyword' },
  { field_name: 'has_codes', field_schema: 'bool' },
  { field_name: 'variable_name', field_schema: 'keyword' },
  { field_name: 'subjects', field_schema: 'keyword' },
  { field_name: 'text_hash', field_schema: 'keyword' },
];

async function main() {
  console.log(`Connecting to Qdrant Cloud cluster...`);
  console.log(`Collection: ${collectionName}`);

  // 1. Fetch collection details
  let info: CollectionInfo;
  try {
    info = await qdrantRequest<CollectionInfo>(`/collections/${collectionName}`);
    console.log(`✓ Collection "${collectionName}" found. Status: ${info.status}`);
    const vectors = info.config?.params?.vectors;
    if (vectors) {
      console.log(`  Vector dimension: ${vectors.size}, Distance metric: ${vectors.distance}`);
    }
  } catch (err) {
    console.error(`Failed to fetch collection "${collectionName}":`, err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // 2. Configure int8 Scalar Quantization if not present
  if (!info.config?.quantization_config) {
    console.log(`Configuring int8 Scalar Quantization (reduces RAM by 4x to fit 1 GB cluster)...`);
    try {
      await qdrantRequest(`/collections/${collectionName}`, {
        method: 'PATCH',
        body: JSON.stringify({
          quantization_config: {
            scalar: {
              type: 'int8',
              quantile: 0.99,
              always_ram: true,
            },
          },
        }),
      });
      console.log(`✓ Scalar Quantization enabled successfully.`);
    } catch (err) {
      console.warn(`Note: Could not patch quantization config (${err instanceof Error ? err.message : err}).`);
    }
  } else {
    console.log(`✓ Quantization config already active.`);
  }

  // 3. Create payload field indexes for pre-filtering
  const existingIndexes = info.payload_schema ?? {};
  console.log(`Configuring payload field indexes for filtering...`);

  for (const { field_name, field_schema } of PAYLOAD_INDEXES) {
    if (existingIndexes[field_name]) {
      console.log(`  ✓ Index on "${field_name}" (${field_schema}) already exists.`);
      continue;
    }

    try {
      await qdrantRequest(`/collections/${collectionName}/index`, {
        method: 'PUT',
        body: JSON.stringify({
          field_name,
          field_schema,
        }),
      });
      console.log(`  ✓ Created index on "${field_name}" (${field_schema}).`);
    } catch (err) {
      console.error(`  × Failed to create index on "${field_name}":`, err instanceof Error ? err.message : err);
    }
  }

  // 4. Verify final status
  const updatedInfo = await qdrantRequest<CollectionInfo>(`/collections/${collectionName}`);
  console.log(`\nCollection setup complete!`);
  console.log(`- Collection: ${collectionName}`);
  console.log(`- Status: ${updatedInfo.status}`);
  console.log(`- Points: ${updatedInfo.points_count ?? 0}`);
  console.log(`- Indexed fields: ${Object.keys(updatedInfo.payload_schema ?? {}).join(', ')}`);
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
