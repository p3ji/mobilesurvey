import { describe, it, expect } from 'vitest';
import {
  parseRecipientList,
  interpolateTemplate,
  buildMailMergeCsv,
  splitCsvLine,
  generateToken,
} from './distributionUtils.js';
import type { AccessCodeRow } from './api.js';

describe('distributionUtils', () => {
  describe('splitCsvLine', () => {
    it('splits simple comma-separated values', () => {
      expect(splitCsvLine('alpha,beta,gamma')).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('respects quoted tokens containing commas', () => {
      expect(splitCsvLine('"Smith, John",john@example.com,"Engineering, QA"')).toEqual([
        'Smith, John',
        'john@example.com',
        'Engineering, QA',
      ]);
    });

    it('handles escaped quotes inside quotes', () => {
      expect(splitCsvLine('"He said ""Hello""",test@example.com')).toEqual([
        'He said "Hello"',
        'test@example.com',
      ]);
    });
  });

  describe('generateToken', () => {
    it('generates an 8-character lowercase alphanumeric token', () => {
      const token = generateToken();
      expect(token).toHaveLength(8);
      expect(/^[2-9a-km-z]+$/.test(token)).toBe(true);
    });

    it('generates distinct tokens on subsequent calls', () => {
      const t1 = generateToken();
      const t2 = generateToken();
      expect(t1).not.toBe(t2);
    });
  });

  describe('parseRecipientList', () => {
    it('parses CSV with headers: email, name, and custom columns', () => {
      const csv = `email,name,department,location
alice@example.com,Alice Smith,Research,Ottawa
bob@example.com,Bob Jones,Operations,Montreal`;

      const result = parseRecipientList(csv);
      expect(result.errors).toHaveLength(0);
      expect(result.recipients).toHaveLength(2);

      expect(result.recipients[0]?.email).toBe('alice@example.com');
      expect(result.recipients[0]?.name).toBe('Alice Smith');
      expect(result.recipients[0]?.customFields).toEqual({
        department: 'Research',
        location: 'Ottawa',
      });
      expect(result.recipients[0]?.code).toBeDefined();

      expect(result.recipients[1]?.email).toBe('bob@example.com');
      expect(result.recipients[1]?.name).toBe('Bob Jones');
      expect(result.detectedColumns).toEqual(['department', 'location']);
    });

    it('parses raw text list of emails without headers', () => {
      const text = `test1@example.com
test2@example.com
test3@example.com`;

      const result = parseRecipientList(text);
      expect(result.errors).toHaveLength(0);
      expect(result.recipients).toHaveLength(3);
      expect(result.recipients[0]?.email).toBe('test1@example.com');
      expect(result.recipients[1]?.email).toBe('test2@example.com');
      expect(result.recipients[2]?.email).toBe('test3@example.com');
    });

    it('deduplicates emails and ignores malformed rows with error report', () => {
      const csv = `email,name
dup@example.com,First
dup@example.com,Second
invalid-email,No At Sign
good@example.com,Valid User`;

      const result = parseRecipientList(csv);
      expect(result.recipients).toHaveLength(2);
      expect(result.recipients.map((r) => r.email)).toEqual(['dup@example.com', 'good@example.com']);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Invalid or missing email');
    });
  });

  describe('interpolateTemplate', () => {
    it('replaces tokens with provided values', () => {
      const template = 'Hi {{name}}, please take {{survey_title}} at {{survey_link}} for {{department}}.';
      const vars = {
        name: 'Jordan',
        survey_title: 'Annual Feedback',
        survey_link: 'https://example.com/survey',
        department: 'Statistics',
      };
      const result = interpolateTemplate(template, vars);
      expect(result).toBe('Hi Jordan, please take Annual Feedback at https://example.com/survey for Statistics.');
    });

    it('handles missing variables gracefully with empty string', () => {
      const template = 'Hello {{name}}, code: {{access_code}} (extra: {{missing}}).';
      const result = interpolateTemplate(template, { name: 'Jordan', access_code: 'XYZ123' });
      expect(result).toBe('Hello Jordan, code: XYZ123 (extra: ).');
    });
  });

  describe('buildMailMergeCsv', () => {
    it('generates a CSV with personalized links, access codes, and custom fields', () => {
      const rows: AccessCodeRow[] = [
        {
          code: 'tok123',
          surveyId: 's-demo',
          email: 'alice@example.com',
          respondentName: 'Alice Smith',
          respondentFieldsJson: { dept: 'Health', region: 'ON' },
          status: 'ready',
          sentAt: null,
          startedAt: null,
          completedAt: null,
          usedAt: null,
        },
        {
          code: 'tok456',
          surveyId: 's-demo',
          email: 'bob@example.com',
          respondentName: 'Bob Martin',
          respondentFieldsJson: { dept: 'Finance', region: 'QC' },
          status: 'completed',
          sentAt: '2026-10-01T12:00:00Z',
          startedAt: '2026-10-01T12:05:00Z',
          completedAt: '2026-10-01T12:15:00Z',
          usedAt: '2026-10-01T12:15:00Z',
        },
      ];

      const csv = buildMailMergeCsv('s-demo', rows);
      const lines = csv.split('\n');
      expect(lines[0]).toBe('email,name,personalized_survey_link,access_code,status,sent_at,started_at,completed_at,dept,region');
      expect(lines[1]).toContain('"alice@example.com"');
      expect(lines[1]).toContain('"tok123"');
      expect(lines[1]).toContain('token=tok123');
      expect(lines[2]).toContain('"bob@example.com"');
      expect(lines[2]).toContain('"completed"');
    });
  });
});
