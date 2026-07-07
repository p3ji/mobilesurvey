import { describe, it, expect } from 'vitest';
import { buildReport, formatReportText, formatReportHtml } from '../reporter.js';
import type { ScenarioRunResult } from '../runner.js';
import type { Scenario } from '../types.js';

describe('reporter', () => {
  const mockScenario: Scenario = {
    id: 'test-scenario-1',
    strategy: 'coverage',
    steps: [
      { instanceKey: 'q1@', variableRef: 'q1', value: 'yes', domainType: 'code', isRoutingVar: true },
      { instanceKey: 'q2@', variableRef: 'q2', value: 'test', domainType: 'text', isRoutingVar: false },
    ],
    pageCount: 2,
    questionCount: 2,
    complete: true,
  };

  const mockResultPass: ScenarioRunResult = {
    scenario: mockScenario,
    stepResults: [
      { step: mockScenario.steps[0]!, strategy: { kind: 'select-radio', groupSelector: '[data-q="q1"]', labelText: 'Yes' }, ok: true },
      { step: mockScenario.steps[1]!, strategy: { kind: 'fill-text', inputId: 'q2', value: 'test' }, ok: true },
    ],
    reachedCompletion: true,
    completionScreenshot: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    consoleErrors: [],
    durationMs: 1000,
  };

  const mockResultFail: ScenarioRunResult = {
    scenario: { ...mockScenario, id: 'test-scenario-2' },
    stepResults: [
      {
        step: mockScenario.steps[0]!,
        strategy: { kind: 'select-radio', groupSelector: '[data-q="q1"]', labelText: 'Yes' },
        ok: false,
        error: 'Element not found',
        screenshotBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      },
    ],
    reachedCompletion: false,
    consoleErrors: [],
    durationMs: 500,
  };

  it('buildReport aggregates results into issues', () => {
    const report = buildReport([mockResultPass, mockResultFail]);
    expect(report.totalScenarios).toBe(2);
    expect(report.completedScenarios).toBe(1);
    expect(report.issues.length).toBe(2); // 1 STEP_FAILED + 1 DEAD_END
    expect(report.durationMs).toBe(1500);
  });

  it('formatReportText produces plain-text summary', () => {
    const report = buildReport([mockResultPass, mockResultFail]);
    const text = formatReportText(report);
    expect(text).toContain('1/2 scenarios completed');
    expect(text).toContain('2 issues');
    expect(text).toContain('DEAD_END');
    expect(text).toContain('STEP_FAILED');
  });

  it('formatReportHtml generates valid HTML with embedded screenshots', () => {
    const report = buildReport([mockResultPass, mockResultFail]);
    const html = formatReportHtml(report, [mockResultPass, mockResultFail]);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Questionnaire Bot Test Report');
    expect(html).toContain('50.0%'); // pass rate
    expect(html).toContain('1/2'); // completed
    expect(html).toContain('2'); // issues
    expect(html).toContain('test-scenario-1');
    expect(html).toContain('test-scenario-2');
    expect(html).toContain('data:image/png;base64,'); // embedded screenshots
    expect(html).toContain('Pass</span>'); // pass badge
    expect(html).toContain('Fail</span>'); // fail badge
  });

  it('formatReportHtml handles 100% pass rate', () => {
    const report = buildReport([mockResultPass]);
    const html = formatReportHtml(report, [mockResultPass]);

    expect(html).toContain('100.0%');
    expect(html).toContain('1/1');
  });

  it('formatReportHtml handles no issues', () => {
    const report = buildReport([mockResultPass]);
    const html = formatReportHtml(report, [mockResultPass]);

    expect(html).toContain('✓ No issues found');
    expect(html).toContain('Completion Screen:');
  });

  it('formatReportHtml escapes HTML in messages', () => {
    const resultWithScript = { ...mockResultFail };
    resultWithScript.stepResults[0]!.error = '<script>alert("xss")</script>';

    const report = buildReport([resultWithScript]);
    const html = formatReportHtml(report, [resultWithScript]);

    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
  });
});
