/**
 * Renders one page's worth of `RenderItem`s — the question-rendering body shared by the
 * production respondent runtime, the designer's live preview, and the designer's render mode.
 * Callers own everything around this: pagination, headers, navigation, persistence.
 */
import type { Instrument } from '@mobilesurvey/instrument-schema';
import { createMockSensorServices, type RenderItem, type SensorServices } from '@mobilesurvey/runtime-engine';
import { Control } from './Control.jsx';
import { EditList } from './EditList.jsx';
import { GeolocationQuestion } from './GeolocationQuestion.jsx';
import { TableQuestion } from './TableQuestion.jsx';

// Shared fallback for callers that don't wire real sensors (designer preview, render mode).
const mockSensors = createMockSensorServices();

export function QuestionPage({
  items,
  instrument,
  lang,
  qNumbers,
  onAnswer,
  idFor,
  sensors,
}: {
  /** The current page's items, in document order (e.g. one entry of `paginate(...).pages`). */
  items: RenderItem[];
  instrument: Instrument;
  lang: string;
  /** Sequential question numbers keyed by item key — typically `numberQuestions(pages)`. */
  qNumbers: Map<string, number>;
  onAnswer: (instanceKey: string, value: unknown) => void;
  /**
   * Optional per-item DOM id for the answerable item's wrapper (question/markAll/grid) — lets a
   * caller scroll/jump to a specific question (e.g. the designer preview's question index panel).
   * Omitted by default so callers that don't need it (the respondent runtime) get no extra id.
   */
  idFor?: (key: string) => string | undefined;
  /**
   * Device-sensor implementations for sensor questions (geolocation…). The respondent runtime
   * passes browser-backed services; when omitted (designer preview, render mode, tests) a
   * deterministic mock is used, so sensor questions stay interactive everywhere.
   */
  sensors?: SensorServices;
}) {
  return (
    <>
      {items.map((item) => {
        const qNum = qNumbers.get(item.key) ?? null;

        if (item.kind === 'pageBreak') {
          return item.title ? (
            <h2 key={item.key} className="eq__page-heading">
              {item.title}
            </h2>
          ) : null;
        }
        if (item.kind === 'section') {
          return (
            <h3 key={item.key} className="eq__section-heading">
              {item.title}
            </h3>
          );
        }
        if (item.kind === 'loopHeading') {
          return (
            <div key={item.key} className="eq__loop-heading" style={{ marginInlineStart: item.depth * 8 }}>
              {item.title}
            </div>
          );
        }
        if (item.kind === 'statement') {
          return (
            <div key={item.key} className="eq__statement">
              {item.text}
            </div>
          );
        }

        if (item.kind === 'markAll') {
          const markAllHardEdit = item.firedEdits.some((e) => e.type === 'hard');
          const markAllErrId = markAllHardEdit ? `${item.key}-err` : undefined;
          return (
            <div
              key={item.key}
              id={idFor?.(item.key)}
              className="eq__question"
              style={{ marginInlineStart: item.depth * 8 }}
            >
              <p className="eq__q-text">
                {qNum != null && <span className="eq__q-num">Q{qNum}.</span>}
                {item.questionText}
              </p>
              {item.instruction && <p className="eq__instruction">{item.instruction}</p>}
              <div
                className="eq__radios"
                role="group"
                aria-label={item.questionText}
                aria-invalid={markAllHardEdit || undefined}
                aria-describedby={markAllErrId}
              >
                {item.categories.map((cat) => (
                  <label key={cat.code} className="eq__radio">
                    <input
                      type="checkbox"
                      checked={cat.value === 1}
                      onChange={(e) => onAnswer(cat.instanceKey, e.target.checked ? 1 : 2)}
                    />
                    {cat.label}
                  </label>
                ))}
              </div>
              <EditList edits={item.firedEdits} id={markAllErrId} />
            </div>
          );
        }

        if (item.kind === 'table') {
          return (
            <TableQuestion
              key={item.key}
              item={item}
              qNum={qNum}
              wrapperId={idFor?.(item.key)}
              onAnswer={onAnswer}
            />
          );
        }

        if (item.kind === 'geolocation') {
          return (
            <GeolocationQuestion
              key={item.key}
              item={item}
              qNum={qNum}
              wrapperId={idFor?.(item.key)}
              lang={lang}
              sensors={sensors ?? mockSensors}
              onAnswer={onAnswer}
            />
          );
        }

        if (item.kind === 'grid') {
          const gridHardEdit = item.firedEdits.some((e) => e.type === 'hard');
          const gridErrId = gridHardEdit ? `${item.key}-err` : undefined;
          return (
            <div
              key={item.key}
              id={idFor?.(item.key)}
              className="eq__question"
              style={{ marginInlineStart: item.depth * 8 }}
            >
              <p className="eq__q-text">
                {qNum != null && <span className="eq__q-num">Q{qNum}.</span>}
                {item.questionText}
              </p>
              {item.instruction && <p className="eq__instruction">{item.instruction}</p>}
              <div
                className="eq__grid-wrapper"
                aria-invalid={gridHardEdit || undefined}
                aria-describedby={gridErrId}
              >
                <table className="eq__grid">
                  <thead>
                    <tr>
                      <th className="eq__grid__corner" />
                      {item.columns.map((col) => (
                        <th key={col.code} className="eq__grid__col-hdr">{col.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {item.rows.map((row) => (
                      <tr key={row.code} className="eq__grid__row">
                        <td className="eq__grid__row-lbl">{row.label}</td>
                        {item.columns.map((col) => (
                          <td key={col.code} className="eq__grid__cell">
                            <input
                              type="radio"
                              name={`${item.key}-${row.code}`}
                              aria-label={`${row.label}: ${col.label}`}
                              checked={row.value === col.code}
                              onChange={() => onAnswer(row.instanceKey, col.code)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <EditList edits={item.firedEdits} id={gridErrId} />
            </div>
          );
        }

        // Regular question.
        const inputId = `eq-ctrl-${item.key}`;
        const isGroupDomain =
          item.construct.responseDomain.type === 'code' ||
          item.construct.responseDomain.type === 'boolean';
        const hasHardEdit = item.firedEdits.some((e) => e.type === 'hard');
        const errId = hasHardEdit ? `${inputId}-err` : undefined;
        return (
          <div
            key={item.key}
            id={idFor?.(item.key)}
            className="eq__question"
            style={{ marginInlineStart: item.depth * 8 }}
          >
            {/* Group domains (code/boolean) reference this label via the group's
                aria-labelledby, so it needs its own id; other domains associate via
                htmlFor pointing at the control's id instead — giving the label the same
                id as the control in that case would be a duplicate DOM id. */}
            <label
              id={isGroupDomain ? inputId : undefined}
              className="eq__q-text"
              htmlFor={isGroupDomain ? undefined : inputId}
            >
              {qNum != null && <span className="eq__q-num">Q{qNum}.</span>}
              {item.text}
              {item.construct.required && (
                <span aria-hidden="true" className="eq__req">
                  {' '}
                  *
                </span>
              )}
            </label>
            {item.instruction && <p className="eq__instruction">{item.instruction}</p>}
            <Control
              domain={
                item.construct.responseDomain as Exclude<
                  typeof item.construct.responseDomain,
                  { type: 'markAll' }
                >
              }
              inputId={inputId}
              value={item.value}
              instrument={instrument}
              lang={lang}
              required={item.construct.required}
              hasError={hasHardEdit}
              errorId={errId}
              onChange={(v) => onAnswer(item.instanceKey, v)}
            />
            <EditList edits={item.firedEdits} id={errId} />
          </div>
        );
      })}
    </>
  );
}
