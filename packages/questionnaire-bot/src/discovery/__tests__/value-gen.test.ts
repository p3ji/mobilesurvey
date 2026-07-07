import { describe, it, expect } from 'vitest';
import { generateDiscoveryValue } from '../value-gen.js';
import type { DiscoveredField, DiscoveredOption } from '../types.js';

function opt(label: string, value: string): DiscoveredOption {
  return { label, value, selector: `[data-qbot-idx="${value}"]` };
}

describe('generateDiscoveryValue', () => {
  it('radio-group: returns the first non-placeholder option', () => {
    const field: DiscoveredField = {
      kind: 'radio-group',
      label: 'Do you agree?',
      selector: '[data-qbot-idx="g1"]',
      options: [opt('Yes', 'yes'), opt('No', 'no')],
      required: true,
    };
    expect(generateDiscoveryValue(field)).toEqual(opt('Yes', 'yes'));
  });

  it('select: skips a "-- Select --" placeholder option with empty value', () => {
    const field: DiscoveredField = {
      kind: 'select',
      label: 'Country',
      selector: '[data-qbot-idx="s1"]',
      options: [opt('-- Select --', ''), opt('Canada', 'CA'), opt('USA', 'US')],
      required: false,
    };
    expect(generateDiscoveryValue(field)).toEqual(opt('Canada', 'CA'));
  });

  it('select: skips a placeholder-looking option even if it has a non-empty value', () => {
    const field: DiscoveredField = {
      kind: 'select',
      label: 'Country',
      selector: '[data-qbot-idx="s1"]',
      options: [opt('Please select', '0'), opt('Canada', 'CA')],
      required: false,
    };
    expect(generateDiscoveryValue(field)).toEqual(opt('Canada', 'CA'));
  });

  it('select: falls back to the first option if every option looks like a placeholder', () => {
    const field: DiscoveredField = {
      kind: 'select',
      label: 'Country',
      selector: '[data-qbot-idx="s1"]',
      options: [opt('-- Select --', '')],
      required: false,
    };
    expect(generateDiscoveryValue(field)).toEqual(opt('-- Select --', ''));
  });

  it('checkbox-group: returns an array with the first real option', () => {
    const field: DiscoveredField = {
      kind: 'checkbox-group',
      label: 'Interests',
      selector: '[data-qbot-idx="g1"]',
      options: [opt('Sports', 'sports'), opt('Music', 'music')],
      required: false,
    };
    expect(generateDiscoveryValue(field)).toEqual([opt('Sports', 'sports')]);
  });

  it('checkbox-group: returns an empty array when there are no options', () => {
    const field: DiscoveredField = {
      kind: 'checkbox-group',
      label: 'Interests',
      selector: '[data-qbot-idx="g1"]',
      options: [],
      required: false,
    };
    expect(generateDiscoveryValue(field)).toEqual([]);
  });

  it('checkbox-single: always returns true', () => {
    const field: DiscoveredField = {
      kind: 'checkbox-single',
      label: 'I agree to the terms',
      selector: '[data-qbot-idx="c1"]',
      required: true,
    };
    expect(generateDiscoveryValue(field)).toBe(true);
  });

  it('email: returns a well-formed test email regardless of label', () => {
    const field: DiscoveredField = {
      kind: 'email',
      label: 'Your email',
      selector: '[data-qbot-idx="e1"]',
      required: true,
    };
    expect(generateDiscoveryValue(field)).toBe('test@example.com');
  });

  it('tel: returns a placeholder phone number', () => {
    const field: DiscoveredField = { kind: 'tel', label: 'Phone', selector: '[data-qbot-idx="t1"]', required: false };
    expect(generateDiscoveryValue(field)).toBe('555-0100');
  });

  it('url: returns a placeholder URL', () => {
    const field: DiscoveredField = { kind: 'url', label: 'Website', selector: '[data-qbot-idx="u1"]', required: false };
    expect(generateDiscoveryValue(field)).toBe('https://example.com');
  });

  it('date: returns today in YYYY-MM-DD format', () => {
    const field: DiscoveredField = { kind: 'date', label: 'Birthdate', selector: '[data-qbot-idx="d1"]', required: false };
    const value = generateDiscoveryValue(field) as string;
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('number: returns the midpoint of min/max when both are declared', () => {
    const field: DiscoveredField = {
      kind: 'number',
      label: 'Age',
      selector: '[data-qbot-idx="n1"]',
      required: false,
      min: '20',
      max: '40',
    };
    expect(generateDiscoveryValue(field)).toBe(30);
  });

  it('number: returns min when only min is declared', () => {
    const field: DiscoveredField = { kind: 'number', label: 'Quantity', selector: '[data-qbot-idx="n1"]', required: false, min: '3' };
    expect(generateDiscoveryValue(field)).toBe(3);
  });

  it('number: returns max when only max is declared', () => {
    const field: DiscoveredField = { kind: 'number', label: 'Quantity', selector: '[data-qbot-idx="n1"]', required: false, max: '10' };
    expect(generateDiscoveryValue(field)).toBe(10);
  });

  it('number: falls back to a default when no bounds are declared', () => {
    const field: DiscoveredField = { kind: 'number', label: 'Quantity', selector: '[data-qbot-idx="n1"]', required: false };
    expect(generateDiscoveryValue(field)).toBe(5);
  });

  it('textarea: returns descriptive test text', () => {
    const field: DiscoveredField = { kind: 'textarea', label: 'Comments', selector: '[data-qbot-idx="ta1"]', required: false };
    expect(generateDiscoveryValue(field)).toContain('test response');
  });

  it('textarea: clamps to maxLength when declared', () => {
    const field: DiscoveredField = {
      kind: 'textarea',
      label: 'Comments',
      selector: '[data-qbot-idx="ta1"]',
      required: false,
      maxLength: 5,
    };
    expect((generateDiscoveryValue(field) as string).length).toBeLessThanOrEqual(5);
  });

  it('text: uses a label-based hint for an email-like label on a generic text input', () => {
    const field: DiscoveredField = { kind: 'text', label: 'Email address', selector: '[data-qbot-idx="e1"]', required: false };
    expect(generateDiscoveryValue(field)).toBe('test@example.com');
  });

  it('text: uses a label-based hint for a name field', () => {
    const field: DiscoveredField = { kind: 'text', label: 'Full name', selector: '[data-qbot-idx="n1"]', required: false };
    expect(generateDiscoveryValue(field)).toBe('Test Respondent');
  });

  it('text: falls back to a generic response when no hint matches', () => {
    const field: DiscoveredField = { kind: 'text', label: 'Favorite color', selector: '[data-qbot-idx="c1"]', required: false };
    expect(generateDiscoveryValue(field)).toBe('Test response');
  });

  it('text: clamps to maxLength when declared', () => {
    const field: DiscoveredField = {
      kind: 'text',
      label: 'Favorite color',
      selector: '[data-qbot-idx="c1"]',
      required: false,
      maxLength: 4,
    };
    expect(generateDiscoveryValue(field)).toBe('Test');
  });
});
