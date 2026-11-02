import { describe, it, expect } from 'vitest';
import {
  normalizeText,
  calculateMatchScore,
  matchDimensionMembers,
  compileCoordinate,
} from '../src/engine/fuzzy-matcher.js';
import type { CubeMetadata } from '../src/types.js';

describe('Fuzzy Member Matcher', () => {
  it('normalizes diacritics and symbols cleanly', () => {
    expect(normalizeText('Montréal, Québec')).toBe('montreal quebec');
    expect(normalizeText('Labour force - 15 years & over')).toBe('labour force 15 years over');
  });

  it('scores exact and partial token matches', () => {
    expect(calculateMatchScore('Ontario', 'Ontario')).toBe(1.0);
    expect(calculateMatchScore('Ontario', 'Province of Ontario')).toBeGreaterThanOrEqual(0.85);
    expect(calculateMatchScore('unemployment', 'Unemployment rate')).toBeGreaterThanOrEqual(0.7);
  });

  it('matches dimension members across a mock StatCan cube', () => {
    const mockMeta: CubeMetadata = {
      productId: 14100287,
      cubeTitleEn: 'Labour force characteristics',
      dimensions: [
        {
          dimensionPositionId: 1,
          dimensionNameEn: 'Geography',
          members: [
            { memberId: 1, memberNameEn: 'Canada' },
            { memberId: 2, memberNameEn: 'Ontario' },
            { memberId: 3, memberNameEn: 'Quebec' },
          ],
        },
        {
          dimensionPositionId: 2,
          dimensionNameEn: 'Labour force characteristics',
          members: [
            { memberId: 1, memberNameEn: 'Population' },
            { memberId: 2, memberNameEn: 'Labour force' },
            { memberId: 3, memberNameEn: 'Unemployment rate' },
          ],
        },
      ],
    };

    const matches = matchDimensionMembers(mockMeta, ['Ontario', 'Unemployment rate']);

    expect(matches['Ontario']?.length).toBeGreaterThan(0);
    expect(matches['Ontario']?.[0]?.memberId).toBe(2);
    expect(matches['Ontario']?.[0]?.dimensionPositionId).toBe(1);

    expect(matches['Unemployment rate']?.length).toBeGreaterThan(0);
    expect(matches['Unemployment rate']?.[0]?.memberId).toBe(3);
    expect(matches['Unemployment rate']?.[0]?.dimensionPositionId).toBe(2);

    // Compile coordinate: Position 1 -> Ontario (2), Position 2 -> Unemployment rate (3) + 8 zeros
    const coord = compileCoordinate(mockMeta, { 1: 2, 2: 3 });
    expect(coord).toBe('2.3.0.0.0.0.0.0.0.0');
  });
});
