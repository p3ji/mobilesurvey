/**
 * Paste-from-Excel support for `table` questions: parse a TSV clipboard block into numbers and
 * map it onto table cells from an anchor position (Excel semantics — clipboard cell (i, j)
 * lands on grid cell (anchorRow + i, anchorCol + j)).
 */
import type { RenderItem } from '@mobilesurvey/runtime-engine';

type TableItem = Extract<RenderItem, { kind: 'table' }>;

/**
 * Parse a TSV clipboard block into a number matrix; `null` marks an uninterpretable cell.
 * Handles CRLF, a trailing newline, currency symbols, thousands separators, spaces, and
 * accounting negatives ("(1,234)" → -1234).
 */
export function parseTsvBlock(text: string): (number | null)[][] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) =>
    line.split('\t').map((raw) => {
      let s = raw.trim();
      if (s === '') return null;
      let negative = false;
      const paren = /^\((.*)\)$/.exec(s);
      if (paren) {
        negative = true;
        s = paren[1]!.trim();
      }
      s = s.replace(/[$€£¥]/g, '').replace(/[,\s ]/g, '');
      if (s === '' || s === '-') return null;
      const n = Number(s);
      if (!Number.isFinite(n)) return null;
      return negative ? -n : n;
    }),
  );
}

/**
 * Map a parsed block onto a table from an anchor cell; returns `[instanceKey, value]` pairs.
 * Out-of-range, disabled and computed targets, and `null` values are dropped without shifting
 * the rest of the block.
 */
export function mapPasteToCells(
  item: TableItem,
  anchorRow: number,
  anchorCol: number,
  block: (number | null)[][],
): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (let i = 0; i < block.length; i++) {
    const r = anchorRow + i;
    if (r >= item.rows.length) break;
    const rowCells = item.cells[r];
    if (!rowCells) continue;
    const blockRow = block[i]!;
    for (let j = 0; j < blockRow.length; j++) {
      const c = anchorCol + j;
      if (c >= item.columns.length) break;
      const value = blockRow[j];
      if (value === null || value === undefined) continue;
      const cell = rowCells[c];
      if (!cell || cell.disabled || cell.computed) continue;
      out.push([cell.instanceKey, value]);
    }
  }
  return out;
}
