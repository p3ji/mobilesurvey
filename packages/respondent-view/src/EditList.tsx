/** Renders a question's fired edits (hard/soft). Shared by every respondent-facing surface. */
import type { FiredEdit } from '@mobilesurvey/runtime-engine';

export function EditList({ edits, id }: { edits: FiredEdit[]; id?: string }) {
  if (!edits.length) return null;
  return (
    <ul id={id} className="eq__edits">
      {edits.map((e) => (
        // The alert/status role is on a nested <span>, not the <li> itself: an explicit role on
        // <li> overrides its implicit `listitem` role, which breaks the <ul>'s list semantics for
        // assistive tech (axe-core's `list` rule). The nested span still gets announced as a live
        // region — role placement doesn't need to be the list item itself for that to work.
        <li key={e.id} className={`eq__edit eq__edit--${e.type}`}>
          <span role={e.type === 'hard' ? 'alert' : 'status'}>
            {e.type === 'hard' ? '⛔ ' : '⚠ '}
            {e.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
