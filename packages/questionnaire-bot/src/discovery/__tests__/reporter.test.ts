import { describe, it, expect } from 'vitest';
import {
  buildDiscoveryReport,
  formatDiscoveryReportText,
  formatDiscoveryReportHtml,
} from '../reporter.js';
import type { DiscoveryRunResult } from '../types.js';

describe('discovery reporter', () => {
  const passResult: DiscoveryRunResult = {
    visits: [
      { pageIndex: 0, url: 'http://localhost/step1', fieldsDiscovered: 2, fieldsAnswered: 2 },
      { pageIndex: 1, url: 'http://localhost/step2', fieldsDiscovered: 1, fieldsAnswered: 1 },
    ],
    issues: [],
    reachedEnd: true,
    consoleErrorCount: 0,
    durationMs: 1200,
    completionScreenshot: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  };

  const failResult: DiscoveryRunResult = {
    visits: [{ pageIndex: 0, url: 'http://localhost/step1', fieldsDiscovered: 1, fieldsAnswered: 0 }],
    issues: [
      { kind: 'FIELD_FAILED', pageIndex: 0, message: 'Failed to answer field "Name"' },
      { kind: 'NO_PROGRESS', pageIndex: 0, message: 'Clicking next did not change the page' },
    ],
    reachedEnd: false,
    consoleErrorCount: 0,
    durationMs: 500,
  };

  it('buildDiscoveryReport aggregates visit and issue counts', () => {
    const report = buildDiscoveryReport(passResult);
    expect(report.pagesVisited).toBe(2);
    expect(report.totalFieldsDiscovered).toBe(3);
    expect(report.totalFieldsAnswered).toBe(3);
    expect(report.reachedEnd).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it('buildDiscoveryReport prepends a FATAL_ERROR issue when the run failed outright', () => {
    const fatalResult: DiscoveryRunResult = {
      visits: [],
      issues: [],
      reachedEnd: false,
      consoleErrorCount: 0,
      durationMs: 100,
      fatalError: 'net::ERR_CONNECTION_REFUSED',
    };
    const report = buildDiscoveryReport(fatalResult);
    expect(report.issues[0]!.kind).toBe('FATAL_ERROR');
    expect(report.issues[0]!.message).toContain('ERR_CONNECTION_REFUSED');
  });

  it('formatDiscoveryReportText summarizes a passing run', () => {
    const report = buildDiscoveryReport(passResult);
    const text = formatDiscoveryReportText(report);
    expect(text).toContain('2 page(s) visited');
    expect(text).toContain('3/3 field(s) answered');
    expect(text).toContain('reached end');
    expect(text).toContain('No issues found.');
  });

  it('formatDiscoveryReportText lists issues for a failing run', () => {
    const report = buildDiscoveryReport(failResult);
    const text = formatDiscoveryReportText(report);
    expect(text).toContain('did not reach end');
    expect(text).toContain('FIELD_FAILED');
    expect(text).toContain('NO_PROGRESS');
  });

  it('formatDiscoveryReportHtml embeds the completion screenshot and page details', () => {
    const report = buildDiscoveryReport(passResult);
    const html = formatDiscoveryReportHtml(report, passResult);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Questionnaire Bot Discovery Report');
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('Page 0');
    expect(html).toContain('Page 1');
    expect(html).toContain('No issues on this page');
  });

  it('formatDiscoveryReportHtml renders issue cards for a failing run', () => {
    const report = buildDiscoveryReport(failResult);
    const html = formatDiscoveryReportHtml(report, failResult);
    expect(html).toContain('FIELD_FAILED');
    expect(html).toContain('NO_PROGRESS');
  });

  it('formatDiscoveryReportHtml escapes HTML in issue messages', () => {
    const xssResult: DiscoveryRunResult = {
      visits: [{ pageIndex: 0, url: 'http://localhost/', fieldsDiscovered: 0, fieldsAnswered: 0 }],
      issues: [{ kind: 'FIELD_FAILED', pageIndex: 0, message: '<script>alert(1)</script>' }],
      reachedEnd: false,
      consoleErrorCount: 0,
      durationMs: 10,
    };
    const report = buildDiscoveryReport(xssResult);
    const html = formatDiscoveryReportHtml(report, xssResult);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
  });
});
