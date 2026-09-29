/**
 * `table` response domain: flattening, synthetic totals (including backward references from
 * earlier sections), required semantics, edit gating, numbering, and loop scoping.
 */
import { describe, it, expect } from 'vitest';
import { fsepInstrument, type Instrument } from '@mobilesurvey/instrument-schema';
import { flattenInstrument, collectEdits } from '../flatten.js';
import { paginate, pageHasHardEdits, numberQuestions } from '../paginate.js';
import { instanceKey } from '../scope.js';
import type { RenderItem, RuntimeState } from '../types.js';

type TableItem = Extract<RenderItem, { kind: 'table' }>;

function stateWith(responses: Record<string, unknown>, language = 'en'): RuntimeState {
  return { responses, sample: {}, language };
}

function tableByPrefix(items: RenderItem[], prefix: string): TableItem {
  const t = items.find((i) => i.kind === 'table' && i.variablePrefix === prefix);
  if (!t || t.kind !== 'table') throw new Error(`${prefix} table not found`);
  return t;
}

describe('table flattening (FSEP)', () => {
  it('emits the R&D table with a total row/col, aligned cells, and disabled cells marked', () => {
    const { items } = flattenInstrument(fsepInstrument, stateWith({}));
    const t = tableByPrefix(items, 'RD');
    expect(t.rows.map((r) => r.code)).toEqual(['inhouse', 'contracts', 'grants', 'fellows', 'admin', 'capital', 'TOT']);
    expect(t.rows[6]!.isTotal).toBe(true);
    expect(t.columns.map((c) => c.code)).toEqual(['intra', 'be', 'he', 'np', 'gov', 'fp', 'TOT']);
    expect(t.columns[6]!.isTotal).toBe(true);
    expect(t.cells).toHaveLength(7);
    expect(t.cells.every((row) => row.length === 7)).toBe(true);
    // 'inhouse' row: only the 'intra' cell is enabled (in-house R&D is intramural-only).
    expect(t.cells[0]![0]!.disabled).toBe(false);
    expect(t.cells[0]![1]!.disabled).toBe(true); // be
    expect(t.cells[0]![5]!.disabled).toBe(true); // fp
    // 'contracts' row: 'intra' is disabled (contracts are extramural-only).
    expect(t.cells[1]![0]!.disabled).toBe(true);
    expect(t.cells[1]![1]!.disabled).toBe(false); // be
    // Total row/col cells are computed.
    expect(t.cells[6]!.every((c) => c.computed)).toBe(true);
    expect(t.cells.every((row) => row[6]!.computed)).toBe(true);
    expect(t.unit).toBe('CAN$ ’000');
  });

  it('computes row/col/grand totals live, respecting disabled cells, and leaves all-blank totals undefined', () => {
    const empty = tableByPrefix(flattenInstrument(fsepInstrument, stateWith({})).items, 'RD');
    expect(empty.cells[6]![6]!.value).toBeUndefined();

    const responses = {
      [instanceKey('RD_inhouse_intra', [])]: 100,
      [instanceKey('RD_contracts_be', [])]: 50,
    };
    const t = tableByPrefix(flattenInstrument(fsepInstrument, stateWith(responses)).items, 'RD');
    expect(t.cells[0]![6]!.value).toBe(100); // inhouse row total (only intra contributes)
    expect(t.cells[1]![6]!.value).toBe(50); // contracts row total (only be contributes)
    expect(t.cells[6]![6]!.value).toBe(150); // grand total
    expect(t.cells[2]![6]!.value).toBeUndefined(); // grants row untouched
  });

  it('fires the BACKWARD-reference hard balance edit: sources of funds (Section 3A) vs S&T totals (Section 1)', () => {
    const mismatch = {
      [instanceKey('RD_inhouse_intra', [])]: 100,
      [instanceKey('RSA_inhouse_intra', [])]: 50,
      [instanceKey('deptBudget', [])]: 100,
    };
    const { items } = flattenInstrument(fsepInstrument, stateWith(mismatch));
    const otherFundsQ = items.find((i) => i.kind === 'question' && i.construct.id === 'q.otherFunds');
    expect(otherFundsQ?.kind === 'question' ? otherFundsQ.firedEdits.some((e) => e.id === 'edit.funds.balance') : false).toBe(true);

    const balanced = { ...mismatch, [instanceKey('otherFunds', [])]: 50 }; // 100 + 50 = RD 100 + RSA 50
    const { items: ok } = flattenInstrument(fsepInstrument, stateWith(balanced));
    const otherFundsOk = ok.find((i) => i.kind === 'question' && i.construct.id === 'q.otherFunds');
    expect(otherFundsOk?.kind === 'question' ? otherFundsOk.firedEdits.some((e) => e.id === 'edit.funds.balance') : true).toBe(false);
  });

  it('does not fire the balance edit while the R&D/RSA tables are still empty (isAnswered guard)', () => {
    const { items } = flattenInstrument(
      fsepInstrument,
      stateWith({ [instanceKey('deptBudget', [])]: 100 }),
    );
    const otherFundsQ = items.find((i) => i.kind === 'question' && i.construct.id === 'q.otherFunds');
    expect(otherFundsQ?.kind === 'question' ? otherFundsQ.firedEdits.some((e) => e.id === 'edit.funds.balance') : true).toBe(false);
  });

  it('required table: hard edit when all cells blank, cleared once any enabled cell is answered', () => {
    const empty = tableByPrefix(flattenInstrument(fsepInstrument, stateWith({})).items, 'RD');
    expect(empty.firedEdits.some((e) => e.id === '__required__' && e.type === 'hard')).toBe(true);

    const t = tableByPrefix(
      flattenInstrument(
        fsepInstrument,
        stateWith({ [instanceKey('RD_inhouse_intra', [])]: 5 }),
      ).items,
      'RD',
    );
    expect(t.firedEdits.some((e) => e.id === '__required__')).toBe(false);
  });

  it('fires the soft cross-section region-check edit and counts it via collectEdits', () => {
    const responses = {
      [instanceKey('RD_inhouse_intra', [])]: 100,
      [instanceKey('REG_nl_curRd', [])]: 40,
      [instanceKey('REG_pe_curRd', [])]: 20,
    };
    const result = flattenInstrument(fsepInstrument, stateWith(responses));
    const t = tableByPrefix(result.items, 'REG');
    expect(t.firedEdits.some((e) => e.id === 'edit.region.check' && e.type === 'soft')).toBe(true);
    expect(collectEdits(result).soft).toBeGreaterThanOrEqual(1);
  });

  it('gates navigation via pageHasHardEdits and counts each table once in numberQuestions', () => {
    const { items } = flattenInstrument(fsepInstrument, stateWith({}));
    const { pages } = paginate(items);
    const section1Page = pages.find((p) => p.some((i) => i.kind === 'table' && i.variablePrefix === 'RD'))!;
    expect(pageHasHardEdits(section1Page)).toBe(true); // required RD/RSA tables are empty

    const nums = numberQuestions(pages);
    const tableKeys = items.filter((i) => i.kind === 'table').map((i) => i.key);
    expect(tableKeys).toHaveLength(4); // RD + RSA + FTE (personnel) + REG (region)
    expect(new Set(tableKeys.map((k) => nums.get(k))).size).toBe(4);
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
