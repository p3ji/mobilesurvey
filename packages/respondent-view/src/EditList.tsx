/** Renders a question's fired edits (hard/soft). Shared by every respondent-facing surface. */
import type { FiredEdit } from '@mobilesurvey/runtime-engine';

export function EditList({ edits, id }: { edits: FiredEdit[]; id?: string }) {
  if (!edits.length) return null;
  return (
    <ul id={id} className="eq__edits">
      {edits.map((e) => (
        <li
          key={e.id}
          className={`eq__edit eq__edit--${e.type}`}
          role={e.type === 'hard' ? 'alert' : 'status'}
        >
          {e.type === 'hard' ? '⛔ ' : '⚠ '}
          {e.message}
        </li>
      ))}
    </ul>
  );
}
