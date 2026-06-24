/**
 * Page grouping shared by the designer preview and the respondent runtime: split a flat
 * `RenderItem[]` into pages at `pageBreak` markers, and detect hard edits that should gate
 * forward navigation.
 */
import type { RenderItem } from './types.js';

export interface PaginateResult {
  /** Items grouped into pages; a `pageBreak` item becomes the first element of its page. */
  pages: RenderItem[][];
  /** True if the instrument declares any page breaks (otherwise a single implicit page). */
  hasPaging: boolean;
}

/** Split a flat item list into pages at `pageBreak` markers. */
export function paginate(items: RenderItem[]): PaginateResult {
  const pages: RenderItem[][] = [];
  let current: RenderItem[] = [];
  let hasPaging = false;

  for (const item of items) {
    if (item.kind === 'pageBreak') {
      hasPaging = true;
      if (current.length > 0) pages.push(current);
      current = [item]; // the pageBreak becomes the header of its page
    } else {
      current.push(item);
    }
  }
  if (current.length > 0) pages.push(current);
  if (pages.length === 0) pages.push([]);

  return { pages, hasPaging };
}

/** True if any item on the page has a fired hard edit (required-but-empty or a hard rule). */
export function pageHasHardEdits(pageItems: RenderItem[]): boolean {
  return pageItems.some(
    (item) =>
      (item.kind === 'question' || item.kind === 'markAll') &&
      item.firedEdits.some((e) => e.type === 'hard'),
  );
}
