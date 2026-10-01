/** Fetch the same GSIM role that corpus_search filters on; never classify it in JavaScript. */
export async function fetchVectorRoles(
  supabaseUrl: string,
  anonKey: string,
  recordIds: string[],
): Promise<Map<string, string>> {
  if (recordIds.length === 0) return new Map();
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/corpus_vector_roles`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_record_ids: recordIds }),
  });
  if (!response.ok) {
    throw new Error(`corpus_vector_roles failed (${response.status}): ${(await response.text()).slice(0, 250)}`);
  }
  const rows = await response.json() as Array<{ record_id: string; role: string }>;
  const roles = new Map(rows.map(({ record_id, role }) => [record_id, role]));
  if (roles.size !== new Set(recordIds).size || [...roles.values()].some((role) => !['collected', 'derived', 'administrative', 'process'].includes(role))) {
    throw new Error('corpus_vector_roles returned missing or invalid roles; vector indexing stopped.');
  }
  return roles;
}
