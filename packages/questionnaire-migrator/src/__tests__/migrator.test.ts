import { describe, it, expect } from 'vitest';
import { migrate, parseQuestionnaire } from '../index.js';

// ── Parser tests ──────────────────────────────────────────────────────────────

describe('parseQuestionnaire', () => {
  it('extracts a simple numbered question list', () => {
    const text = `
1. What is your age?
   (Enter number)

2. What is your sex?
   1. Male
   2. Female
   3. Other / prefer not to say

3. Are you currently employed?
   [ ] Yes
   [ ] No
`;
    const parsed = parseQuestionnaire(text);
    expect(parsed.sections).toHaveLength(1);
    const qs = parsed.sections[0]!.questions;
    expect(qs).toHaveLength(3);
    expect(qs[0]!.normalizedNumber).toBe('1');
    expect(qs[0]!.text).toMatch(/age/i);
    expect(qs[1]!.options).toHaveLength(3);
    expect(qs[2]!.options).toHaveLength(2);
  });

  it('detects section headers', () => {
    const text = `
SECTION A: Demographics

1. How old are you?

SECTION B: Employment

2. Are you employed?
   [ ] Yes
   [ ] No
`;
    const parsed = parseQuestionnaire(text);
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0]!.title).toMatch(/Demographics/i);
    expect(parsed.sections[1]!.title).toMatch(/Employment/i);
    expect(parsed.sections[0]!.questions).toHaveLength(1);
    expect(parsed.sections[1]!.questions).toHaveLength(1);
  });

  it('infers question types correctly', () => {
    const text = `
1. What is your age? (Enter number)

2. What is your sex?
   1. Male
   2. Female

3. Are you employed?
   [ ] Yes
   [ ] No

4. Select all topics you are interested in. (Select all that apply)
   1. Science
   2. Arts
   3. Technology

5. Please describe your main occupation.

6. What is your date of birth? (Enter date)
`;
    const parsed = parseQuestionnaire(text);
    const qs = parsed.sections[0]!.questions;
    expect(qs[0]!.type).toBe('numeric');
    expect(qs[1]!.type).toBe('single');
    expect(qs[2]!.type).toBe('boolean');
    expect(qs[3]!.type).toBe('multiple');
    expect(qs[4]!.type).toBe('text');
    expect(qs[5]!.type).toBe('date');
  });

  it('parses Q-prefixed question numbers', () => {
    const text = `
Q1. What is your name?
Q2. What is your age? (Enter number)
`;
    const parsed = parseQuestionnaire(text);
    const qs = parsed.sections[0]!.questions;
    expect(qs[0]!.normalizedNumber).toBe('1');
    expect(qs[1]!.normalizedNumber).toBe('2');
    expect(qs[1]!.type).toBe('numeric');
  });

  it('extracts skip logic from option arrows', () => {
    const text = `
1. Are you currently employed?
   [ ] Yes → Skip to Q3
   [ ] No

2. How long have you been unemployed? (Enter number, 0-60 months)

3. What is your main occupation?
`;
    const parsed = parseQuestionnaire(text);
    const q1 = parsed.sections[0]!.questions[0]!;
    expect(q1.options?.[0]?.skipTo).toBe('3');
  });

  it('extracts skip logic from "If Yes, go to Q#" patterns', () => {
    const text = `
1. Do you own a car?
   [ ] Yes
   [ ] No
   If Yes, go to Q3

2. How do you usually travel?

3. How many cars do you own? (Enter number)
`;
    const parsed = parseQuestionnaire(text);
    const q1 = parsed.sections[0]!.questions[0]!;
    expect(q1.skipRules?.[0]?.condition).toBe('yes');
    expect(q1.skipRules?.[0]?.targetNumber).toBe('3');
  });

  it('normalises dotted sub-question numbers', () => {
    const text = `
1.1. What province do you live in?
1.2. What city?
`;
    const parsed = parseQuestionnaire(text);
    const qs = parsed.sections[0]!.questions;
    expect(qs[0]!.normalizedNumber).toBe('1_1');
    expect(qs[1]!.normalizedNumber).toBe('1_2');
  });
});

// ── Full migration tests ──────────────────────────────────────────────────────

describe('migrate', () => {
  it('produces a valid Instrument structure', () => {
    const text = `
Youth Employment Survey

SECTION A: About you

1. What is your age? (Enter number, 15-80)

2. What is your gender?
   1. Male
   2. Female
   3. Non-binary / other

3. Are you currently enrolled in school?
   [ ] Yes → Skip to Q5
   [ ] No

4. What was your last year of schooling?
   1. Primary school
   2. Secondary school
   3. Post-secondary

SECTION B: Employment

5. Are you currently employed?
   [ ] Yes
   [ ] No

6. How many hours per week do you work? (Enter number, 0-168)
`;
    const result = migrate(text, { title: 'Youth Employment Survey', agency: 'Test Agency' });

    expect(result.questionCount).toBe(6);
    expect(result.sectionCount).toBe(2);
    expect(result.instrument.ddiProfile).toBe('ddi-lifecycle-3.3');
    expect(result.instrument.metadata.title.en).toBe('Youth Employment Survey');
    expect(result.instrument.metadata.agency).toBe('Test Agency');
    expect(result.instrument.variables).toHaveLength(6);
    expect(result.instrument.categorySchemes.length).toBeGreaterThan(0);

    // Root sequence should have page children
    const root = result.instrument.sequence;
    expect(root.type).toBe('sequence');
    expect(root.children.length).toBeGreaterThan(0);

    // Section pages
    const pg1 = root.children[0];
    expect(pg1?.type).toBe('sequence');
    expect((pg1 as { isPage?: boolean }).isPage).toBe(true);
  });

  it('applies visibleWhen from skip logic', () => {
    const text = `
1. Are you employed?
   [ ] Yes → Skip to Q3
   [ ] No

2. How long have you been unemployed? (Enter number)

3. What is your occupation?
`;
    const result = migrate(text);
    expect(result.warnings.filter(w => w.includes('not found'))).toHaveLength(0);

    // Q2 should have a visibleWhen that hides it when Q1=Yes
    const allConstructs: unknown[] = [];
    const visit = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      allConstructs.push(node);
      const n = node as Record<string, unknown>;
      for (const arr of [n['children'], n['then'], n['else']]) {
        if (Array.isArray(arr)) arr.forEach(visit);
      }
    };
    visit(result.instrument.sequence);

    const q2 = allConstructs.find(
      c => (c as Record<string, unknown>)['type'] === 'question' &&
           (c as Record<string, unknown>)['variableRef'] === 'q2'
    ) as Record<string, unknown> | undefined;

    expect(q2).toBeDefined();
    expect(typeof q2?.['visibleWhen']).toBe('string');
  });

  it('handles text with no sections gracefully', () => {
    const text = `1. What is your name?\n2. How old are you? (Enter number)\n`;
    const result = migrate(text);
    expect(result.questionCount).toBe(2);
    expect(result.warnings).not.toContain(expect.stringMatching(/error/i));
  });

  it('produces no typecheck-busting variable names', () => {
    const text = `
1. First question?
1. Duplicate question number?
`;
    const result = migrate(text);
    // Should produce a warning about the duplicate, not crash
    const names = result.instrument.variables.map(v => v.name);
    // All names should be unique
    expect(new Set(names).size).toBe(names.length);
  });
});
