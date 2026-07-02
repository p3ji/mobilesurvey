import { describe, it, expect } from 'vitest';
import { paginate, pageHasHardEdits, numberQuestions } from '../paginate.js';
import type { FiredEdit, RenderItem } from '../types.js';

function question(key: string, firedEdits: FiredEdit[] = []): RenderItem {
  return {
    kind: 'question',
    key,
    instanceKey: key,
    // Minimal stand-in — paginate/numberQuestions/pageHasHardEdits only touch kind/key/firedEdits.
    construct: {} as never,
    text: key,
    value: undefined,
    firedEdits,
    depth: 0,
  };
}

function pageBreak(key: string): RenderItem {
  return { kind: 'pageBreak', key, title: key };
}

function statement(key: string): RenderItem {
  return { kind: 'statement', key, text: key, depth: 0 };
}

describe('paginate', () => {
  it('groups a single implicit page when there are no page breaks', () => {
    const { pages, hasPaging } = paginate([question('q1'), question('q2')]);
    expect(hasPaging).toBe(false);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(2);
  });

  it('splits into pages at pageBreak markers, keeping the marker as the page head', () => {
    const { pages, hasPaging } = paginate([
      pageBreak('p1'),
      question('q1'),
      pageBreak('p2'),
      question('q2'),
      question('q3'),
    ]);
    expect(hasPaging).toBe(true);
    expect(pages).toHaveLength(2);
    expect(pages[0]?.map((i) => i.key)).toEqual(['p1', 'q1']);
    expect(pages[1]?.map((i) => i.key)).toEqual(['p2', 'q2', 'q3']);
  });
});

describe('pageHasHardEdits', () => {
  it('is false when no item has a fired hard edit', () => {
    expect(pageHasHardEdits([question('q1', [{ id: 'e', type: 'soft', message: 'm' }])])).toBe(false);
  });

  it('is true when a question item has a fired hard edit', () => {
    expect(pageHasHardEdits([question('q1', [{ id: 'e', type: 'hard', message: 'm' }])])).toBe(true);
  });

  it('detects hard edits on markAll and grid items, not just question', () => {
    const markAll: RenderItem = {
      kind: 'markAll',
      key: 'ma1',
      constructId: 'c',
      variablePrefix: 'p',
      questionText: 'q',
      categories: [],
      firedEdits: [{ id: 'e', type: 'hard', message: 'm' }],
      depth: 0,
    };
    const grid: RenderItem = {
      kind: 'grid',
      key: 'g1',
      constructId: 'c',
      variablePrefix: 'p',
      questionText: 'q',
      rows: [],
      columns: [],
      firedEdits: [{ id: 'e', type: 'hard', message: 'm' }],
      depth: 0,
    };
    expect(pageHasHardEdits([markAll])).toBe(true);
    expect(pageHasHardEdits([grid])).toBe(true);
  });
});

describe('numberQuestions', () => {
  it('numbers question/markAll/grid items sequentially across pages, skipping other kinds', () => {
    const pages: RenderItem[][] = [
      [pageBreak('p1'), statement('s1'), question('q1')],
      [pageBreak('p2'), question('q2'), question('q3')],
    ];
    const numbers = numberQuestions(pages);
    expect(numbers.get('q1')).toBe(1);
    expect(numbers.get('q2')).toBe(2);
    expect(numbers.get('q3')).toBe(3);
    expect(numbers.has('p1')).toBe(false);
    expect(numbers.has('s1')).toBe(false);
  });
});
