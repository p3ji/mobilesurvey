import { describe, expect, it } from 'vitest';
import { cleanSemanticQuestion } from '../vector/cleanSemanticQuestion.js';

describe('cleanSemanticQuestion', () => {
  it('strips recall period lead-ins', () => {
    expect(
      cleanSemanticQuestion('In the past 12 months, how often did you smoke cigarettes?')
    ).toBe('How often did you smoke cigarettes?');

    expect(
      cleanSemanticQuestion('During the past three months, have you used online banking?')
    ).toBe('Used online banking?');
  });

  it('extracts substantive sub-item from multi-part battery questions ending in ?', () => {
    expect(
      cleanSemanticQuestion('Which of the following online payment options are accepted through this business’ websites or apps? Cryptocurrency')
    ).toBe('online payment options: Cryptocurrency');

    expect(
      cleanSemanticQuestion('Which of the following Information and Communication Technologies (ICTs) did this business use in 2023? Blockchain technologies')
    ).toBe('Information and Communication Technologies (ICTs): Blockchain technologies');
  });

  it('strips procedural prompts and prompt tails', () => {
    expect(
      cleanSemanticQuestion('In the past month, how often did you feel so sad? Would you say:')
    ).toBe('How often did you feel so sad?');

    expect(
      cleanSemanticQuestion('People use different methods to send money to relatives living outside Canada. For each method, indicate whether you have used - Using a cryptocurrency')
    ).toBe('Using a cryptocurrency');
  });

  it('preserves questions that do not have boilerplate scaffolding', () => {
    expect(
      cleanSemanticQuestion('Total personal income before taxes')
    ).toBe('Total personal income before taxes');

    expect(
      cleanSemanticQuestion('Hours worked per week at main job')
    ).toBe('Hours worked per week at main job');
  });
});
