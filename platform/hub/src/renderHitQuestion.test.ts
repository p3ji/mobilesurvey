import { describe, expect, it } from 'vitest';
import { renderHitQuestion } from './renderHitQuestion.js';

describe('renderHitQuestion', () => {
  it('returns undefined if question is missing or identical to label', () => {
    expect(renderHitQuestion(undefined, 'Age')).toBeUndefined();
    expect(renderHitQuestion(null, 'Age')).toBeUndefined();
    expect(renderHitQuestion('Age', 'Age')).toBeUndefined();
  });

  it('stitches trailing colon, dash, and em-dash with concept label', () => {
    expect(
      renderHitQuestion('In the past 12 months, which aids did you use:', 'Cane or walking stick')
    ).toBe('In the past 12 months, which aids did you use: — Cane or walking stick');

    expect(
      renderHitQuestion('In the past 12 months, which aids did you use -', 'Manual wheelchair')
    ).toBe('In the past 12 months, which aids did you use - — Manual wheelchair');
  });

  it('stitches select-all questions ending in question mark with introductory stems', () => {
    expect(
      renderHitQuestion(
        'In the past 12 months, did you use any of the following mobility aids?',
        'Walker',
        true
      )
    ).toBe('In the past 12 months, did you use any of the following mobility aids? — Walker');
  });

  it('does NOT stitch if concept is a placeholder (e.g. Q14, Question 32, Yes/No)', () => {
    expect(
      renderHitQuestion('In responding to incidents, which did your business contact:', 'Q14')
    ).toBe('In responding to incidents, which did your business contact:');

    expect(
      renderHitQuestion('In responding to incidents, which did your business contact:', 'Question 32')
    ).toBe('In responding to incidents, which did your business contact:');

    expect(
      renderHitQuestion('Did your business use financing?', 'Yes/No', true)
    ).toBe('Did your business use financing?');
  });

  it('does NOT stitch if label is already in the question text', () => {
    expect(
      renderHitQuestion('Did you use a cane or walking stick?', 'Cane or walking stick')
    ).toBe('Did you use a cane or walking stick?');
  });

  it('leaves standard non-battery questions unchanged', () => {
    expect(
      renderHitQuestion('What is your current employment status?', 'Labour force status', false)
    ).toBe('What is your current employment status?');
  });
});
