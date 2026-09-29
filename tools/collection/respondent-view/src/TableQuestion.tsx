/**
 * Establishment data table: spreadsheet-style numeric entry over rows × columns, with live
 * computed total cells, disabled cells, a unit caption, and paste-from-Excel (TSV block fill
 * anchored at the focused cell).
 */
import type { ClipboardEvent } from 'react';
import type { RenderItem } from '@mobilesurvey/runtime-engine';
import { EditList } from './EditList.jsx';
import { mapPasteToCells, parseTsvBlock } from './tablePaste.js';

type TableItem = Extract<RenderItem, { kind: 'table' }>;

export function TableQuestion({
  item,
  qNum,
  wrapperId,
  onAnswer,
}: {
  item: TableItem;
  qNum: number | null;
  wrapperId?: string;
  onAnswer: (instanceKey: string, value: unknown) => void;
}) {
  const hasHardEdit = item.firedEdits.some((e) => e.type === 'hard');
  const errId = hasHardEdit ? `${item.key}-err` : undefined;
  const decimals = item.decimals ?? 0;
  const step = decimals > 0 ? 10 ** -decimals : 1;

  const commit = (instanceKey: string, raw: string) => {
    if (raw === '') {
      onAnswer(instanceKey, undefined);
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) onAnswer(instanceKey, n);
  };

  const handlePaste = (rowIdx: number, colIdx: number, e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes('\n')) return; // single value: default paste
    e.preventDefault();
    for (const [key, value] of mapPasteToCells(item, rowIdx, colIdx, parseTsvBlock(text))) {
      onAnswer(key, value);
    }
  };

  return (
    <div
      id={wrapperId}
      className="eq__question"
      style={{ marginInlineStart: item.depth * 8 }}
    >
      <p className="eq__q-text">
        {qNum != null && <span className="eq__q-num">Q{qNum}.</span>}
        {item.questionText}
        {item.required && (
          <span aria-hidden="true" className="eq__req">
            {' '}
            *
          </span>
        )}
      </p>
      {item.instruction && <p className="eq__instruction">{item.instruction}</p>}
      <div
        className="eq__table-wrapper"
        aria-invalid={hasHardEdit || undefined}
        aria-describedby={errId}
      >
        <table className="eq__table">
          {item.unit && <caption className="eq__table__unit">{item.unit}</caption>}
          <thead>
            <tr>
              <th className="eq__table__corner" />
              {item.columns.map((col) => (
                <th
                  key={col.code}
                  scope="col"
                  className={
                    col.isTotal ? 'eq__table__col-hdr eq__table__col-hdr--total' : 'eq__table__col-hdr'
                  }
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {item.rows.map((row, rowIdx) => (
              <tr key={row.code}>
                <th
                  scope="row"
                  className={
                    row.isTotal ? 'eq__table__row-lbl eq__table__row-lbl--total' : 'eq__table__row-lbl'
                  }
                >
                  {row.label}
                </th>
                {item.columns.map((col, colIdx) => {
                  const cell = item.cells[rowIdx]?.[colIdx];
                  if (!cell) return <td key={col.code} />;
                  if (cell.computed) {
                    return (
                      <td
                        key={col.code}
                        className="eq__table__cell eq__table__cell--computed"
                        aria-label={`${row.label}, ${col.label}: total`}
                      >
                        {cell.value !== undefined ? cell.value.toFixed(decimals) : ''}
                      </td>
                    );
                  }
                  if (cell.disabled) {
                    return (
                      <td key={col.code} className="eq__table__cell eq__table__cell--disabled">
                        <span aria-hidden="true">—</span>
                      </td>
                    );
                  }
                  return (
                    <td key={col.code} className="eq__table__cell">
                      <input
                        type="number"
                        inputMode="decimal"
                        dir="ltr"
                        className="eq__table__input"
                        step={step}
                        min={item.min}
                        max={item.max}
                        aria-label={`${row.label}, ${col.label}${item.unit ? `, ${item.unit}` : ''}`}
                        value={cell.value ?? ''}
                        onChange={(e) => commit(cell.instanceKey, e.target.value)}
                        onPaste={(e) => handlePaste(rowIdx, colIdx, e)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <EditList edits={item.firedEdits} id={errId} />
    </div>
  );
}
