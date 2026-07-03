/**
 * `table` response domain: flattening, synthetic totals (including backward references from
 * earlier sections), required semantics, edit gating, numbering, and loop scoping.
 */
import { describe, it, expect } from 'vitest';
import { bizdemoInstrument, type Instrument } from '@mobilesurvey/instrument-schema';
import { flattenInstrument, collectEdits } from '../flatten.js';
import { paginate, pageHasHardEdits, numberQuestions } from '../paginate.js';
import { instanceKey } from '../scope.js';
import type { RenderItem, RuntimeState } from '../types.js';

type TableItem = Extract<RenderItem, { kind: 'table' }>;

function stateWith(responses: Record<string, unknown>, language = 'en'): RuntimeState {
  return { responses, sample: {}, language };
}

function salesTable(items: RenderItem[]): TableItem {
  const t = items.find((i) => i.kind === 'table' && i.variablePrefix === 'SALES');
  if (!t || t.kind !== 'table') throw new Error('SALES table not found');
  return t;
}

describe('table flattening (bizdemo)', () => {
  it('emits a table item with a total row, aligned cells, and the disabled cell marked', () => {
    const { items } = flattenInstrument(bizdemoInstrument, stateWith({}));
    const t = salesTable(items);
    expect(t.rows.map((r) => r.code)).toEqual(['spirits', 'wine', 'beer', 'other', 'TOT']);
    expect(t.rows[4]!.isTotal).toBe(true);
    expect(t.columns.map((c) => c.code)).toEqual(['vol', 'val']);
    expect(t.cells).toHaveLength(5);
    expect(t.cells.every((row) => row.length === 2)).toBe(true);
    // disabledCells: ['other:vol'] — row index 3, col index 0
    expect(t.cells[3]![0]!.disabled).toBe(true);
    expect(t.cells[3]![1]!.disabled).toBe(false);
    // total row cells are computed
    expect(t.cells[4]!.every((c) => c.computed)).toBe(true);
    expect(t.unit).toBe('in thousands');
  });

  it('computes column totals live and leaves all-blank totals undefined', () => {
    const empty = salesTable(flattenInstrument(bizdemoInstrument, stateWith({})).items);
    expect(empty.cells[4]![1]!.value).toBeUndefined();

    const responses = {
      [instanceKey('SALES_spirits_val', [])]: 100,
      [instanceKey('SALES_wine_val', [])]: 50,
    };
    const t = salesTable(flattenInstrument(bizdemoInstrument, stateWith(responses)).items);
    expect(t.cells[4]![1]!.value).toBe(150); // SALES_TOT_val
    expect(t.cells[4]![0]!.value).toBeUndefined(); // vol column untouched
  });

  it('fires the BACKWARD-reference balance edit: revGross (Section 2) vs SALES_TOT_val (Section 3)', () => {
    const mismatch = {
      [instanceKey('revGross', [])]: 100,
      [instanceKey('SALES_spirits_val', [])]: 150,
    };
    const { items } = flattenInstrument(bizdemoInstrument, stateWith(mismatch));
    const revQ = items.find((i) => i.kind === 'question' && i.construct.id === 'q.revGross');
    expect(revQ?.kind === 'question' ? revQ.firedEdits.some((e) => e.id === 'edit.revGross.balance') : false).toBe(true);

    const balanced = {
      [instanceKey('revGross', [])]: 150,
      [instanceKey('SALES_spirits_val', [])]: 150,
    };
    const { items: ok } = flattenInstrument(bizdemoInstrument, stateWith(balanced));
    const revOk = ok.find((i) => i.kind === 'question' && i.construct.id === 'q.revGross');
    expect(revOk?.kind === 'question' ? revOk.firedEdits.some((e) => e.id === 'edit.revGross.balance') : true).toBe(false);
  });

  it('does not fire the balance edit while the table is still empty (isAnswered guard)', () => {
    const { items } = flattenInstrument(
      bizdemoInstrument,
      stateWith({ [instanceKey('revGross', [])]: 100 }),
    );
    const revQ = items.find((i) => i.kind === 'question' && i.construct.id === 'q.revGross');
    expect(revQ?.kind === 'question' ? revQ.firedEdits.some((e) => e.id === 'edit.revGross.balance') : true).toBe(false);
  });

  it('required table: hard edit when all cells blank, cleared once any cell is answered', () => {
    const empty = salesTable(flattenInstrument(bizdemoInstrument, stateWith({})).items);
    expect(empty.firedEdits.some((e) => e.id === '__required__' && e.type === 'hard')).toBe(true);

    const t = salesTable(
      flattenInstrument(
        bizdemoInstrument,
        stateWith({ [instanceKey('SALES_beer_vol', [])]: 5 }),
      ).items,
    );
    expect(t.firedEdits.some((e) => e.id === '__required__')).toBe(false);
  });

  it('fires the soft large-value edit and counts it via collectEdits', () => {
    const result = flattenInstrument(
      bizdemoInstrument,
      stateWith({ [instanceKey('SALES_spirits_val', [])]: 200000 }),
    );
    const t = salesTable(result.items);
    expect(t.firedEdits.some((e) => e.id === 'edit.sales.large' && e.type === 'soft')).toBe(true);
    expect(collectEdits(result).soft).toBeGreaterThanOrEqual(1);
  });

  it('gates navigation via pageHasHardEdits and counts each table once in numberQuestions', () => {
    const { items } = flattenInstrument(bizdemoInstrument, stateWith({}));
    const { pages } = paginate(items);
    const salesPage = pages.find((p) => p.some((i) => i.kind === 'table'))!;
    expect(pageHasHardEdits(salesPage)).toBe(true); // required SALES table is empty

    const nums = numberQuestions(pages);
    const tableKeys = items.filter((i) => i.kind === 'table').map((i) => i.key);
    expect(tableKeys).toHaveLength(2); // SALES + PURCH
    expect(new Set(tableKeys.map((k) => nums.get(k))).size).toBe(2);
  });
});

describe('table inside a loop (scoped cells)', () => {
  const s = (en: string) => ({ en });
  const loopInstrument: Instrument = {
    id: 'urn:ddi:test:looptable:1.0',
    version: '1.0.0',
    ddiProfile: 'ddi-lifecycle-3.3',
    languages: ['en'],
    defaultLanguage: 'en',
    metadata: { title: s('Loop table test') },
    concepts: [],
    universes: [],
    categorySchemes: [
      {
        id: 'cs.rows',
        label: s('Rows'),
        categories: [
          { code: 'a', label: s('A') },
          { code: 'b', label: s('B') },
        ],
      },
      {
        id: 'cs.cols',
        label: s('Cols'),
        categories: [{ code: 'x', label: s('X') }],
      },
    ],
    variables: [
      { id: 'v.n', name: 'n', kind: 'collected', label: s('Count'), representation: 'numeric' },
      { id: 'v.anchor', name: 'anchor', kind: 'hidden', label: s('Anchor'), representation: 'text' },
    ],
    prefillMappings: [],
    sequence: {
      type: 'sequence',
      id: 'seq.root',
      children: [
        { type: 'question', id: 'q.n', variableRef: 'n', text: s('How many?'), responseDomain: { type: 'numeric' } },
        {
          type: 'loop',
          id: 'loop.sites',
          loopVariable: 'i',
          countVariableRef: 'n',
          label: s('Site'),
          children: [
            {
              type: 'question',
              id: 'q.tbl',
              variableRef: 'anchor',
              text: s('Site data'),
              responseDomain: {
                type: 'table',
                rowSchemeRef: 'cs.rows',
                colSchemeRef: 'cs.cols',
                variablePrefix: 'T',
                totalRow: true,
              },
            },
          ],
        },
      ],
    },
  };

  it('scopes cell instance keys per iteration and totals stay per-scope', () => {
    const responses = {
      [instanceKey('n', [])]: 2,
      [instanceKey('T_a_x', [{ name: 'i', index: 1 }])]: 10,
      [instanceKey('T_a_x', [{ name: 'i', index: 2 }])]: 99,
      [instanceKey('T_b_x', [{ name: 'i', index: 1 }])]: 5,
    };
    const { items } = flattenInstrument(loopInstrument, stateWith(responses));
    const tables = items.filter((i): i is TableItem => i.kind === 'table');
    expect(tables).toHaveLength(2);
    expect(tables[0]!.cells[0]![0]!.instanceKey).toBe('T_a_x@i=1');
    expect(tables[1]!.cells[0]![0]!.instanceKey).toBe('T_a_x@i=2');
    // Totals: iteration 1 = 10 + 5 = 15; iteration 2 = 99 (b blank)
    expect(tables[0]!.cells[2]![0]!.value).toBe(15);
    expect(tables[1]!.cells[2]![0]!.value).toBe(99);
  });
});
