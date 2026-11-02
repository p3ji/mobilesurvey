/**
 * Fuzzy Member Matching & Coordinate Compiler for Statistics Canada Cubes
 * Ported and enhanced from eurostat-assistant category matching logic.
 */

import type { CubeMetadata } from '../types.js';

export interface MemberMatch {
  dimensionPositionId: number;
  dimensionName: string;
  memberId: number;
  memberName: string;
  score: number;
}

/**
 * Normalize string by removing diacritics and non-alphanumeric characters.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenize string into meaningful keywords, ignoring common stop words.
 */
const STOP_WORDS = new Set(['and', 'or', 'the', 'of', 'in', 'for', 'by', 'at', 'to', 'total', 'all']);

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Score similarity between a search query and a target member label.
 */
export function calculateMatchScore(query: string, target: string): number {
  const normQuery = normalizeText(query);
  const normTarget = normalizeText(target);

  if (normQuery === normTarget) return 1.0;
  if (normTarget.includes(normQuery)) return 0.9;
  if (normQuery.includes(normTarget)) return 0.85;

  const queryTokens = tokenize(query);
  const targetTokens = tokenize(target);

  if (queryTokens.length === 0 || targetTokens.length === 0) return 0;

  const targetSet = new Set(targetTokens);
  let matched = 0;
  for (const token of queryTokens) {
    if (targetSet.has(token)) {
      matched++;
    } else {
      // Partial prefix match
      for (const t of targetTokens) {
        if (t.startsWith(token) || token.startsWith(t)) {
          matched += 0.5;
          break;
        }
      }
    }
  }

  return (matched / queryTokens.length) * 0.8;
}

/**
 * Search all dimensions of a cube to find members that match given search terms.
 */
export function matchDimensionMembers(
  meta: CubeMetadata,
  queries: string[],
  minScore = 0.45
): Record<string, MemberMatch[]> {
  const results: Record<string, MemberMatch[]> = {};

  for (const q of queries) {
    const candidates: MemberMatch[] = [];

    for (const dim of meta.dimensions) {
      for (const m of dim.members) {
        const score = calculateMatchScore(q, m.memberNameEn);
        if (score >= minScore) {
          candidates.push({
            dimensionPositionId: dim.dimensionPositionId,
            dimensionName: dim.dimensionNameEn,
            memberId: m.memberId,
            memberName: m.memberNameEn,
            score,
          });
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    results[q] = candidates;
  }

  return results;
}

/**
 * Compile a full StatCan coordinate string (e.g. "1.1.1.1.0.0.0.0.0.0")
 * from dimension member selections or match queries.
 */
export function compileCoordinate(
  meta: CubeMetadata,
  selectedMemberIdsByPosition: Record<number, number>
): string {
  const parts: string[] = [];

  for (const dim of meta.dimensions) {
    const pos = dim.dimensionPositionId;
    const selectedId = selectedMemberIdsByPosition[pos];

    if (selectedId != null && selectedId > 0) {
      // Verify member exists in dimension
      const exists = dim.members.some((m) => m.memberId === selectedId);
      parts.push(exists ? String(selectedId) : '1');
    } else {
      // Default to 1 (usually the aggregate/total member in StatCan)
      parts.push('1');
    }
  }

  return parts.join('.');
}
