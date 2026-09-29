import type { ControlConstruct, Instrument, QuestionConstruct } from '@mobilesurvey/instrument-schema';

/**
 * Depth-first, routing-blind walk of every question construct in an instrument (mirrors the
 * tree walk `runtime-engine/flatten.ts` uses internally for `buildSyntheticTotals`). Shared by
 * every engine module that needs a question's response-domain shape without paying for a full
 * `flattenInstrument` pass (which requires per-response state and evaluates visibility).
 *
 * `inLoop` tells the visitor whether this question sits inside a roster — callers that need an
 * accurate per-response denominator (e.g. missingness rates) should skip rostered variables
 * rather than count them against the wrong total.
 */
export function walkQuestions(
  instrument: Instrument,
  visit: (question: QuestionConstruct, inLoop: boolean) => void,
): void {
  const go = (nodes: ControlConstruct[], inLoop: boolean): void => {
    for (const node of nodes) {
      switch (node.type) {
        case 'sequence':
          go(node.children, inLoop);
          break;
        case 'loop':
          go(node.children, true);
          break;
        case 'ifThenElse':
          go(node.then, inLoop);
          go(node.else ?? [], inLoop);
          break;
        case 'question':
          visit(node, inLoop);
          break;
        default:
          break;
      }
    }
  };
  go(instrument.sequence.children, false);
}
