import { describe, it, expect } from 'vitest';
import type { RenderItem } from '@mobilesurvey/runtime-engine';
import { parseTsvBlock, mapPasteToCells } from '../tablePaste.js';

type TableItem = Extract<RenderItem, { kind: 'table' }>;

describe('parseTsvBlock', () => {
  it('parses a plain TSV block', () => {
    expect(parseTsvBlock('1\t2\n3\t4')).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('handles CRLF and a trailing newline', () => {
    expect(parseTsvBlock('1\t2\r\n3\t4\r\n')).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('cleans currency symbols, thousands separators, and spaces', () => {
    expect(parseTsvBlock('$1,234\t€ 567')).toEqual([[1234, 567]]);
  });

  it('parses accounting negatives "(500)" as -500', () => {
    expect(parseTsvBlock('(500)\t(1,250)')).toEqual([[-500, -1250]]);
  });

  it('maps blanks and non-numeric cells to null', () => {
    expect(parseTsvBlock('1\t\tabc\n\t2')).toEqual([
      [1, null, null],
      [null, 2],
    ]);
  });
});

describe('mapPasteToCells', () => {
  const item: TableItem = {
    kind: 'table',
    key: 'q.t@',
    constructId: 'q.t',
    variablePrefix: 'T',
    questionText: 'Test',
    rows: [
      { code: 'a', label: 'A' },
      { code: 'b', label: 'B' },
      { code: 'TOT', label: 'Total', isTotal: true },
    ],
    columns: [
      { code: 'x', label: 'X' },
      { code: 'y', label: 'Y' },
    ],
    cells: [
      [
        { instanceKey: 'T_a_x@', value: undefined, disabled: false, computed: false },
        { instanceKey: 'T_a_y@', value: undefined, disabled: true, computed: false },
      ],
      [
        { instanceKey: 'T_b_x@', value: undefined, disabled: false, computed: false },
        { instanceKey: 'T_b_y@', value: undefined, disabled: false, computed: false },
      ],
      [
        { instanceKey: 'T_TOT_x@', value: undefined, disabled: false, computed: true },
        { instanceKey: 'T_TOT_y@', value: undefined, disabled: false, computed: true },
      ],
    ],
    firedEdits: [],
    depth: 0,
  };

  it('fills from the anchor with Excel semantics', () => {
    const out = mapPasteToCells(item, 0, 0, [
      [1, 2],
      [3, 4],
    ]);
    // (0,1) is disabled — dropped without shifting; the rest land in place.
    expect(out).toEqual([
      ['T_a_x@', 1],
      ['T_b_x@', 3],
      ['T_b_y@', 4],
    ]);
  });

  it('drops out-of-range and computed targets and null values', () => {
    const out = mapPasteToCells(item, 1, 0, [
      [7, null, 99],
      [8, 9],
    ]);
    // Row 2 is the computed total row → dropped; col 2 does not exist → dropped.
    expect(out).toEqual([
      ['T_b_x@', 7],
    ]);
  });
});
