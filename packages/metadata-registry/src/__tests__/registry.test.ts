import { describe, it, expect } from 'vitest';
import { lfsInstrument } from '@mobilesurvey/instrument-schema';
import { buildRegistry } from '../extract.js';
import { buildSearchIndex, search } from '../search.js';

const entries = buildRegistry(lfsInstrument);
const index = buildSearchIndex(entries);

describe('buildRegistry', () => {
  it('emits one instrument entry', () => {
    const insts = entries.filter((e) => e.componentType === 'instrument');
    expect(insts).toHaveLength(1);
    expect(insts[0]!.ddi.urn).toBe(lfsInstrument.id);
  });

  it('indexes questions, variables, pages and code lists', () => {
    const byType = (t: string) => entries.filter((e) => e.componentType === t).length;
    expect(byType('question')).toBeGreaterThan(5);
    expect(byType('variable')).toBe(lfsInstrument.variables.length);
    expect(byType('page')).toBeGreaterThan(0);
    expect(byType('codeList')).toBe(lfsInstrument.categorySchemes.length);
  });

  it('captures provenance and the payload for a question', () => {
    const q = entries.find((e) => e.componentType === 'question');
    expect(q?.registry.provenance).toBe(lfsInstrument.id);
    expect(q?.payload).toBeTruthy();
  });

  it('counts code-list usage', () => {
    const industry = entries.find((e) => e.entryId.endsWith('#cs:cs.industry'));
    expect(industry?.registry.usageCount).toBeGreaterThanOrEqual(1);
  });

  it('marks pages with the screen flow target', () => {
    const page = entries.find((e) => e.componentType === 'page');
    expect(page?.eq?.flowTarget).toBe('screen');
  });
});

describe('search', () => {
  it('finds the job-title variable by a term in its label (occupation)', () => {
    const hits = search(index, 'occupation');
    expect(hits.some((h) => h.entry.entryId.endsWith('#var:jobTitle'))).toBe(true);
  });

  it('matches non-exact / synonym queries (employment surfaces job/occupation entries)', () => {
    const hits = search(index, 'employment');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.entry.entryId.endsWith('#var:jobTitle'))).toBe(true);
  });

  it('can restrict by component type', () => {
    const hits = search(index, 'industry', { type: 'codeList' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.entry.componentType === 'codeList')).toBe(true);
    expect(hits.map((h) => (h.entry.payload as { id?: string }).id)).toContain('cs.industry');
  });

  it('returns nothing for an empty query', () => {
    expect(search(index, '   ')).toHaveLength(0);
  });

  it('ranks by relevance with scores in (0,1]', () => {
    const hits = search(index, 'marital status');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.score).toBeGreaterThan(0);
    expect(hits[0]!.score).toBeLessThanOrEqual(1.0001);
  });
});
