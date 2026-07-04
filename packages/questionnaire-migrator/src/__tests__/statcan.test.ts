/**
 * Regression tests against real Statistics Canada questionnaires (text extracted
 * from the published PDFs — see fixtures/).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateInstrument } from '@mobilesurvey/instrument-schema';
import type { QuestionConstruct, SequenceConstruct } from '@mobilesurvey/instrument-schema';
import { parse as parseExpr } from '@mobilesurvey/expression-engine';
import { migrate, looksLikeStatcanEQ } from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, 'fixtures', f), 'utf8');

const csbc = read('statcan-csbc-2026q2.txt');
const liquor = read('statcan-liquor-1726.txt');
const payroll = read('statcan-payroll-1713.txt');

function allQuestions(result: ReturnType<typeof migrate>): QuestionConstruct[] {
  return (result.instrument.sequence.children as SequenceConstruct[]).flatMap(
    (p) => p.children as QuestionConstruct[],
  );
}

describe('StatCan EQ format detection', () => {
  it('detects the CSBC electronic questionnaire', () => {
    expect(looksLikeStatcanEQ(csbc)).toBe(true);
  });
  it('does not fire on paper forms', () => {
    expect(looksLikeStatcanEQ(liquor)).toBe(false);
    expect(looksLikeStatcanEQ(payroll)).toBe(false);
  });
});

describe('CSBC (Canadian Survey on Business Conditions)', () => {
  const result = migrate(csbc);
  const questions = allQuestions(result);
  const byVar = new Map(questions.map((q) => [q.variableRef, q]));

  it('uses the EQ parser and finds the survey shape', () => {
    expect(result.format).toBe('statcan-eq');
    expect(result.instrument.metadata.title.en).toBe(
      'Canadian Survey on Business Conditions, second quarter of 2026',
    );
    expect(result.questionCount).toBeGreaterThanOrEqual(65);
    expect(result.sectionCount).toBeGreaterThanOrEqual(12);
  });

  it('detects named sections', () => {
    const titles = result.sections.map((s) => s.title);
    expect(titles).toContain('Business or organization information');
    expect(titles).toContain('Business or organization obstacles');
    expect(titles).toContain('Trade');
    expect(titles).toContain('Debt');
    expect(titles).toContain('Ownership');
  });

  it('produces a valid instrument', () => {
    const v = validateInstrument(result.instrument);
    expect(v.ok).toBe(true);
  });

  it('every generated visibleWhen parses in the expression engine', () => {
    for (const q of questions) {
      if (q.visibleWhen) expect(() => parseExpr(q.visibleWhen!)).not.toThrow();
    }
  });

  it('splits matrix questions into one sub-question per row', () => {
    // Q4 is a 15+ row grid rated on Increase / Stay about the same / Decrease …
    const q4rows = questions.filter((q) => q.variableRef.startsWith('q4_'));
    expect(q4rows.length).toBeGreaterThanOrEqual(14);
    expect(q4rows[0]!.text.en).toBe('Number of employees');
    const dom = q4rows[0]!.responseDomain;
    expect(dom.type).toBe('code');
  });

  it('parses "Select all that apply" as multi-select', () => {
    const q3 = byVar.get('q3')!;
    expect(q3.responseDomain).toMatchObject({ type: 'code', selection: 'multiple' });
  });

  it('maps flow conditions onto visibleWhen', () => {
    // "If at least two obstacles are selected in Q5, go to Q6."
    expect(byVar.get('q6')!.visibleWhen).toBe('count($q5) >= 2');
    // "If the percentage … reported in Q12 was greater than 0, go to Q16."
    expect(byVar.get('q16')!.visibleWhen).toBe('$q12 > 0');
    // "If 'Government agency' was selected in Q1, go to Q12. Otherwise, go to Q11."
    expect(byVar.get('q11')!.visibleWhen).toBe("!($q1 == '1')");
  });

  it('handles multi-source flow conditions ("Yes" in Q28 or Q29)', () => {
    expect(byVar.get('q30')!.visibleWhen).toBe("($q28 == '1' || $q29 == '1')");
  });

  it('extracts lettered sub-questions as percentages', () => {
    const q39a = byVar.get('q39_a')!;
    expect(q39a.text.en).toContain('owned by women');
    expect(q39a.responseDomain).toMatchObject({ type: 'numeric', min: 0, max: 100 });
    // Flow after Q38: only private sector businesses reach the Ownership block.
    expect(q39a.visibleWhen).toBe("$q1 == '2'");
    expect(byVar.get('q39_f')).toBeDefined();
  });

  it('links nested follow-ups to their parent option', () => {
    // "Who does this organization primarily serve?" under Q1's Non-profit option
    expect(byVar.get('q1_1')!.visibleWhen).toBe("$q1 == '3'");
    // "What type of AI applications…" under Q33's Yes
    expect(byVar.get('q33_1')!.visibleWhen).toBe("$q33 == '1'");
  });

  it('warns instead of guessing on unsupported conditions', () => {
    expect(result.warnings.some((w) => w.includes('Display condition'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('NAICS'))).toBe(true);
  });
});

describe('paper forms degrade gracefully', () => {
  it('liquor authority report becomes numeric line items', () => {
    const result = migrate(liquor);
    expect(result.format).toBe('generic');
    expect(result.questionCount).toBeGreaterThanOrEqual(10);
    const v = validateInstrument(result.instrument);
    expect(v.ok).toBe(true);
    const numeric = allQuestions(result).filter((q) => q.responseDomain.type === 'numeric');
    expect(numeric.length).toBeGreaterThanOrEqual(8);
  });

  it('bilingual grid form yields a valid (if empty) instrument', () => {
    const result = migrate(payroll);
    const v = validateInstrument(result.instrument);
    expect(v.ok).toBe(true);
  });
});
