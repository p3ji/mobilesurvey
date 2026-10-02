export function isPlaceholderConcept(text?: string | null): boolean {
  if (!text) return true;
  return /^(?:q\s*\d+|question\s*\d+|section\s*[a-z]|yes(?:\/no)?|oui(?:\/non)?|none|null|undefined)$/i.test(text.trim());
}

/**
 * Stitches battery/select-all introductory stems with their specific item concept,
 * while preventing redundant stitching or placeholder concept leakage.
 */
export function renderHitQuestion(
  question?: string | null,
  label?: string | null,
  isSelectAll = false
): string | undefined {
  if (!question || question === label) return undefined;
  const trimmedQ = question.trim();
  if (!label) return question;

  const trimmedL = label.trim();
  if (!trimmedL) return question;

  // Filter out uninformative placeholder concepts
  if (isPlaceholderConcept(trimmedL)) return question;

  // If question already incorporates the label, avoid redundant repetition
  if (trimmedQ.toLowerCase().includes(trimmedL.toLowerCase())) return question;

  // Stitch triggers:
  // 1. Trailing stem punctuation: colon, dash, en-dash, em-dash
  const endsWithStemPunct = /[:\-\u2013\u2014]$/.test(trimmedQ);
  // 2. Trailing question mark or period on an introductory/battery stem (e.g. "any of the following", "select all")
  const isIntroductoryStem = /(?:\b(?:which|any)\s+of\s+the\s+following|\bplease\s+(?:select|mark)\s+all|\bselect\s+all\s+that\s+apply|\bapply\s+for\s+(?:any|which)\b)\b/i.test(trimmedQ);

  if (endsWithStemPunct || isIntroductoryStem || isSelectAll) {
    const cleanStem = trimmedQ.replace(/[\s\-\u2013\u2014]+$/, '');
    return `${cleanStem} — ${trimmedL}`;
  }

  return question;
}
