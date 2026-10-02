import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchVectorRoles } from './roles.js';

// Repair existing points without recomputing embeddings. --apply is required for writes.
for (const path of [
  resolve(import.meta.dirname, '../../.env.local'),
  resolve(import.meta.dirname, '../../.env'),
  resolve(import.meta.dirname, '../../../../../platform/hub/.env.local'),
]) {
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]!]) process.env[match[1]!] = match[2]!.replace(/^['"]|['"]$/g, '');
  }
}

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)?.replace(/\/+$/, '');
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const qdrantUrl = (process.env.QDRANT_URL || process.env.QDRANT_ENDPOINT || process.env.CLUSTER_URL)?.replace(/\/+$/, '');
const qdrantKey = process.env.QDRANT_API_KEY;
const collection = process.env.QDRANT_COLLECTION ?? 'modularsurvey';
const apply = process.argv.includes('--apply');

if (!supabaseUrl || !supabaseKey || !qdrantUrl || !qdrantKey) {
  throw new Error('Supabase and Qdrant credentials are required.');
}

async function qdrantRequest(path: string, body: unknown): Promise<any> {
  const response = await fetch(`${qdrantUrl}${path}`, {
    method: 'POST',
    headers: { 'api-key': qdrantKey!, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Qdrant ${path} failed (${response.status}): ${(await response.text()).slice(0, 250)}`);
  return response.json();
}

async function main(): Promise<void> {
  const checkId = process.argv.find((arg) => arg.startsWith('--check-id='))?.slice('--check-id='.length);
  if (checkId) {
    const expected = (await fetchVectorRoles(supabaseUrl!, supabaseKey!, [checkId])).get(checkId);
    const response = await qdrantRequest(`/collections/${collection}/points`, {
      ids: [checkId], with_payload: ['role'], with_vector: false,
    }) as { result?: Array<{ payload?: { role?: string } }> };
    const actual = response.result?.[0]?.payload?.role;
    if (!actual || actual !== expected) throw new Error(`Role mismatch for ${checkId}: SQL=${expected}, Qdrant=${actual ?? 'missing'}`);
    console.log(`Verified ${checkId}: ${actual}`);
    return;
  }
  let offset: string | number | null = null;
  let scanned = 0;
  let changed = 0;
  do {
    const page = await qdrantRequest(`/collections/${collection}/points/scroll`, {
      limit: 500,
      with_payload: ['role'],
      with_vector: false,
      ...(offset === null ? {} : { offset }),
    }) as { result?: { points?: Array<{ id: string; payload?: { role?: string } }>; next_page_offset?: string | number | null } };
    const points = page.result?.points ?? [];
    if (points.length === 0) break;
    const roles = await fetchVectorRoles(supabaseUrl!, supabaseKey!, points.map((point) => String(point.id)));
    const updates = new Map<string, string[]>();
    for (const point of points) {
      const expected = roles.get(String(point.id))!;
      if (point.payload?.role === expected) continue;
      const ids = updates.get(expected) ?? [];
      ids.push(String(point.id));
      updates.set(expected, ids);
      changed++;
    }
    if (apply && updates.size > 0) {
      for (const [role, ids] of updates) {
        await qdrantRequest(`/collections/${collection}/points/payload?wait=false`, {
          payload: { role }, points: ids,
        });
      }
    }
    scanned += points.length;
    if (scanned % 10_000 < points.length) console.log(`Scanned ${scanned}; ${apply ? 'fixed' : 'mismatched'} ${changed}`);
    offset = page.result?.next_page_offset ?? null;
    // Gentle pacing to keep pod CPU under limits
    await new Promise((r) => setTimeout(r, 25));
  } while (offset !== null);
  console.log(`Scanned ${scanned} Qdrant points; ${apply ? 'fixed' : 'found'} ${changed} role mismatches.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
