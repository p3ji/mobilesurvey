/**
 * Raw responses are never mutated (audit integrity + reversibility). A correction is a layered
 * overlay: `applyCorrections` produces the "edited view" that validation runs and exports should
 * use, while the original `ValidatorResponse[]` — untouched — remains available for a raw export
 * or an audit comparison. See docs/validator-plan.md §6.3.
 */
import type { Correction, ValidatorResponse } from './types.js';

export function applyCorrections(
  responses: ValidatorResponse[],
  corrections: Correction[],
): ValidatorResponse[] {
  const latestByResponse = new Map<string, Map<string, Correction>>();
  for (const c of corrections) {
    let byKey = latestByResponse.get(c.responseId);
    if (!byKey) {
      byKey = new Map();
      latestByResponse.set(c.responseId, byKey);
    }
    const existing = byKey.get(c.instanceKey);
    if (!existing || c.decidedAt > existing.decidedAt) byKey.set(c.instanceKey, c);
  }

  return responses.map((r) => {
    const byKey = latestByResponse.get(r.id);
    if (!byKey || byKey.size === 0) return r;
    const answers = { ...r.answers };
    for (const c of byKey.values()) answers[c.instanceKey] = c.newValue;
    return { ...r, answers };
  });
}
