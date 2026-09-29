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
      (item.kind === 'question' ||
        item.kind === 'markAll' ||
        item.kind === 'grid' ||
        item.kind === 'table' ||
        item.kind === 'geolocation' ||
        item.kind === 'photo') &&
      item.firedEdits.some((e) => e.type === 'hard'),
  );
}

/**
 * Assign 1-based, sequential question numbers across a paginated instrument: `question`,
 * `markAll`, `grid`, `table`, `geolocation` and `photo` items are counted; every other kind is skipped. Shared so the
 * designer preview, the designer's render mode, and the respondent runtime number questions
 * identically.
 */
export function numberQuestions(pages: RenderItem[][]): Map<string, number> {
  const numbers = new Map<string, number>();
  let n = 0;
  for (const page of pages) {
    for (const item of page) {
      if (
        item.kind === 'question' ||
        item.kind === 'markAll' ||
        item.kind === 'grid' ||
        item.kind === 'table' ||
        item.kind === 'geolocation' ||
        item.kind === 'photo'
      ) {
        numbers.set(item.key, ++n);
      }
    }
  }
  return numbers;
}
