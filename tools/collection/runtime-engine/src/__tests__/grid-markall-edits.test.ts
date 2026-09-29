/**
 * Regression test for the open bug (AGENTS.md, 2026-07-03): `flatten.ts` hardcoded
 * `firedEdits: []` for `grid` and `markAll` questions, so authored hard/soft edits on those
 * kinds silently never fired (unlike `question` and `table`, which evaluate their edits).
 * Fixed by computing a required-sentinel (any row/category answered) and calling `evalEdits`,
 * mirroring the `table` branch.
 */
import { describe, it, expect } from 'vitest';
import type { Instrument } from '@mobilesurvey/instrument-schema';
import { flattenInstrument } from '../flatten.js';
import { instanceKey } from '../scope.js';
import type { RenderItem, RuntimeState } from '../types.js';

type GridItem = Extract<RenderItem, { kind: 'grid' }>;
type MarkAllItem = Extract<RenderItem, { kind: 'markAll' }>;

function stateWith(responses: Record<string, unknown>): RuntimeState {
  return { responses, sample: {}, language: 'en' };
}

const s = (en: string) => ({ en });

const instrument: Instrument = {
  id: 'urn:ddi:test:grid-markall-edits:1.0',
  version: '1.0.0',
  ddiProfile: 'ddi-lifecycle-3.3',
  languages: ['en'],
  defaultLanguage: 'en',
  metadata: { title: s('Grid/markAll edits test') },
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
      categories: [
        { code: 'x', label: s('X') },
        { code: 'y', label: s('Y') },
      ],
    },
    {
      id: 'cs.opts',
      label: s('Options'),
      categories: [
        { code: 'none', label: s('None of the above') },
        { code: 'other1', label: s('Option 1') },
        { code: 'other2', label: s('Option 2') },
      ],
    },
  ],
  variables: [
    { id: 'v.grid', name: 'grid', kind: 'hidden', label: s('Grid anchor'), representation: 'text' },
    { id: 'v.mark', name: 'mark', kind: 'hidden', label: s('MarkAll anchor'), representation: 'text' },
  ],
  prefillMappings: [],
  sequence: {
    type: 'sequence',
    id: 'seq.root',
    children: [
      {
        type: 'question',
        id: 'q.grid',
        variableRef: 'grid',
        text: s('Grid question'),
        required: true,
        responseDomain: {
          type: 'grid',
          rowSchemeRef: 'cs.rows',
          colSchemeRef: 'cs.cols',
          variablePrefix: 'G',
        },
        edits: [
          {
            id: 'edit.grid.rowsMatch',
            type: 'hard',
            when: "isAnswered($G_a) && isAnswered($G_b) && $G_a == $G_b",
            message: s('Rows A and B must not have the same answer.'),
          },
        ],
      },
      {
        type: 'question',
        id: 'q.mark',
        variableRef: 'mark',
        text: s('MarkAll question'),
        required: true,
        responseDomain: {
          type: 'markAll',
          categorySchemeRef: 'cs.opts',
          variablePrefix: 'M',
        },
        edits: [
          {
            id: 'edit.mark.noneExclusive',
            type: 'hard',
            when: "isAnswered($M_none) && (isAnswered($M_other1) || isAnswered($M_other2))",
            message: s('Cannot select "None of the above" with another option.'),
          },
        ],
      },
    ],
  },
};

function gridItem(items: RenderItem[]): GridItem {
  const g = items.find((i) => i.kind === 'grid');
  if (!g || g.kind !== 'grid') throw new Error('grid item not found');
  return g;
}

function markAllItem(items: RenderItem[]): MarkAllItem {
  const m = items.find((i) => i.kind === 'markAll');
  if (!m || m.kind !== 'markAll') throw new Error('markAll item not found');
  return m;
}

describe('grid firedEdits (regression: previously hardcoded to [])', () => {
  it('fires the required edit when every row is blank', () => {
    const g = gridItem(flattenInstrument(instrument, stateWith({})).items);
    expect(g.firedEdits.some((e) => e.id === '__required__' && e.type === 'hard')).toBe(true);
  });

  it('clears the required edit once any row is answered', () => {
    const g = gridItem(
      flattenInstrument(instrument, stateWith({ [instanceKey('G_a', [])]: 'x' })).items,
    );
    expect(g.firedEdits.some((e) => e.id === '__required__')).toBe(false);
  });

  it('fires the authored hard edit when both rows match', () => {
    const responses = {
      [instanceKey('G_a', [])]: 'x',
      [instanceKey('G_b', [])]: 'x',
    };
    const g = gridItem(flattenInstrument(instrument, stateWith(responses)).items);
    expect(g.firedEdits.some((e) => e.id === 'edit.grid.rowsMatch' && e.type === 'hard')).toBe(true);
  });

  it('does not fire the authored edit when rows differ', () => {
    const responses = {
      [instanceKey('G_a', [])]: 'x',
      [instanceKey('G_b', [])]: 'y',
    };
    const g = gridItem(flattenInstrument(instrument, stateWith(responses)).items);
    expect(g.firedEdits.some((e) => e.id === 'edit.grid.rowsMatch')).toBe(false);
  });
});

describe('markAll firedEdits (regression: previously hardcoded to [])', () => {
  it('fires the required edit when no category is checked', () => {
    const m = markAllItem(flattenInstrument(instrument, stateWith({})).items);
    expect(m.firedEdits.some((e) => e.id === '__required__' && e.type === 'hard')).toBe(true);
  });

  it('clears the required edit once any category is checked', () => {
    const m = markAllItem(
      flattenInstrument(instrument, stateWith({ [instanceKey('M_other1', [])]: 1 })).items,
    );
    expect(m.firedEdits.some((e) => e.id === '__required__')).toBe(false);
  });

  it('still fires the required edit when a box was toggled off (touched but unchecked)', () => {
    // markAll writes an explicit "unchecked" sentinel (2) the moment a checkbox is toggled,
    // unlike grid which only ever writes on selection. A box that was checked then unchecked
    // must NOT count as "answered" -- regression guard for treating any non-blank cell
    // (checked OR explicitly-unchecked) as satisfying "required".
    const m = markAllItem(
      flattenInstrument(instrument, stateWith({ [instanceKey('M_other1', [])]: 2 })).items,
    );
    expect(m.firedEdits.some((e) => e.id === '__required__' && e.type === 'hard')).toBe(true);
  });

  it('fires the authored exclusivity edit when "none" is checked alongside another option', () => {
    const responses = {
      [instanceKey('M_none', [])]: 1,
      [instanceKey('M_other1', [])]: 1,
    };
    const m = markAllItem(flattenInstrument(instrument, stateWith(responses)).items);
    expect(m.firedEdits.some((e) => e.id === 'edit.mark.noneExclusive' && e.type === 'hard')).toBe(true);
  });

  it('does not fire the exclusivity edit when only one option is checked', () => {
    const m = markAllItem(
      flattenInstrument(instrument, stateWith({ [instanceKey('M_other1', [])]: 1 })).items,
    );
    expect(m.firedEdits.some((e) => e.id === 'edit.mark.noneExclusive')).toBe(false);
  });
});
