/**
 * Strips procedural interview scaffolding and survey boilerplate from question text
 * so the resulting dense embedding represents substantive topical content rather
 * than generic interview phrasing.
 */
export function cleanSemanticQuestion(text: string): string {
  if (!text) return '';
  let s = text.trim();

  // 1. If the question has a question mark followed by a substantive sub-item label
  // e.g. "Which of the following online payment options are accepted through this business’s websites or apps? Cryptocurrency"
  const mSplit = s.match(/\?\s+([A-Z0-9][^?]+)$/);
  if (mSplit && mSplit[1]) {
    const tail = mSplit[1].trim();
    if (!/^(?:did|do|have|would|what|which|how|is|are|were|was)\b/i.test(tail)) {
      let topic = s.slice(0, mSplit.index).replace(/^(?:in|during) the (?:past|last) [^,]+,?\s*/i, '');
      topic = topic.replace(/^(?:which|any) of the following\s+/i, '');
      topic = topic.replace(/\s+(?:did this business|did your business|did you|have you|does this|are accepted|do this)[^?]*$/i, '');
      const trimmedTopic = topic.trim();
      return trimmedTopic.length > 3 ? `${trimmedTopic}: ${tail}` : tail;
    }
  }

  // 2. Strip standard recall period lead-ins (numeric or word count or singular):
  // "In the past 12 months, ", "During the past three months, ", "In the past month, ", "Since 2020, "
  s = s.replace(/^(?:in|during) the (?:past|last) (?:\d+|one|two|three|four|five|six|twelve)?\s*(?:months?|weeks?|days?|years?|mo|yr|wks),?\s*/i, '');
  s = s.replace(/^(?:in|since) \d{4},?\s*/i, '');

  // 3. Strip multi-prompt device scaffolding (PIAAC style):
  s = s.replace(/^(?:outside work|in your everyday life)[^?]+\?\s*(?:\/\s*(?:outside work|in your everyday life)[^?]+\?\s*)?/i, '');

  // 4. Strip generic money transfer / remittance intros:
  s = s.replace(/^people use different (?:methods|ways) to [^.]+\.\s*(?:for each method[^–—:-]*[–—:-]*\s*)?/i, '');

  // 5. Strip standard introductory battery questions:
  s = s.replace(/^(?:which|any) of the following (?:other )?(?:activities|options|methods|services|reasons|problems|statements|features|items|tools|technologies|payment options)?(?:, related to [^,]+,)? (?:have you done|have you performed|have you|did you|do you|did this business|did your business|did your organization|does this business|does your business|does your enterprise|are accepted|apply to you|were used|was used)[^?:]*[?:]\s*/i, '');

  // 6. Strip procedural question heads (with strict word boundaries):
  s = s.replace(/^(?:have you|did you|would you say|did you encounter|please indicate|did this business use)\b:?\s*/i, '');

  // 7. Strip trailing prompt scale tails:
  s = s.replace(/(?:\s*would you say:?\s*|\s*please (?:mark|select) all that apply\.?|\s*did you(?: use)?:?\s*|\s*have you:?\s*|\s*did you encounter:?\s*)$/i, '');

  // 8. Strip leading punctuation:
  s = s.replace(/^[–—:\-\s/]+/, '').trim();

  if (s.length >= 4) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return text.trim();
}
