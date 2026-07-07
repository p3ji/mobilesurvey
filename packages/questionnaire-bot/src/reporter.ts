/**
 * Turns a batch of ScenarioRunResults into a structured report: a machine-readable summary plus
 * a human-readable issue list, with optional HTML report generation including embedded screenshots.
 */
import type { ScenarioRunResult } from './runner.js';

export type IssueKind =
  | 'DEAD_END'
  | 'STEP_FAILED'
  | 'FATAL_ERROR'
  | 'CONSOLE_ERROR';

export interface Issue {
  kind: IssueKind;
  scenarioId: string;
  message: string;
  detail?: unknown;
}

export interface Report {
  totalScenarios: number;
  completedScenarios: number;
  issues: Issue[];
  durationMs: number;
}

export function buildReport(results: ScenarioRunResult[]): Report {
  const issues: Issue[] = [];
  let durationMs = 0;

  for (const r of results) {
    durationMs += r.durationMs;

    if (r.fatalError) {
      issues.push({
        kind: 'FATAL_ERROR',
        scenarioId: r.scenario.id,
        message: `Scenario failed to run: ${r.fatalError}`,
      });
      continue;
    }

    if (!r.reachedCompletion) {
      issues.push({
        kind: 'DEAD_END',
        scenarioId: r.scenario.id,
        message: `Scenario did not reach the completion screen after ${r.stepResults.length} step(s)`,
        detail: { answeredSteps: r.stepResults.filter((s) => s.ok).length },
      });
    }

    for (const step of r.stepResults) {
      if (!step.ok && step.strategy.kind !== 'skip') {
        issues.push({
          kind: 'STEP_FAILED',
          scenarioId: r.scenario.id,
          message: `Failed to answer "${step.step.variableRef}" (${step.strategy.kind}): ${step.error ?? 'unknown error'}`,
          detail: step.step,
        });
      }
    }

    for (const err of r.consoleErrors) {
      issues.push({
        kind: 'CONSOLE_ERROR',
        scenarioId: r.scenario.id,
        message: `[${err.kind}] ${err.message}`,
        detail: err,
      });
    }
  }

  return {
    totalScenarios: results.length,
    completedScenarios: results.filter((r) => r.reachedCompletion).length,
    issues,
    durationMs,
  };
}

/** Plain-text summary suitable for console output or a CI log. */
export function formatReportText(report: Report): string {
  const lines: string[] = [];
  lines.push(
    `Questionnaire Bot Report: ${report.completedScenarios}/${report.totalScenarios} scenarios completed ` +
      `(${report.issues.length} issue${report.issues.length === 1 ? '' : 's'}, ${report.durationMs}ms)`,
  );
  if (report.issues.length === 0) {
    lines.push('No issues found.');
    return lines.join('\n');
  }
  for (const issue of report.issues) {
    lines.push(`  [${issue.kind}] ${issue.scenarioId}: ${issue.message}`);
  }
  return lines.join('\n');
}

/** HTML report with embedded screenshots, styled for readability. */
export function formatReportHtml(report: Report, results: ScenarioRunResult[]): string {
  const passRate = report.totalScenarios > 0 ? ((report.completedScenarios / report.totalScenarios) * 100).toFixed(1) : '0.0';
  const issuesByScenario = new Map<string, Issue[]>();
  for (const issue of report.issues) {
    if (!issuesByScenario.has(issue.scenarioId)) {
      issuesByScenario.set(issue.scenarioId, []);
    }
    issuesByScenario.get(issue.scenarioId)!.push(issue);
  }

  const css = `
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    .header { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-top: 15px; }
    .stat { background: #f9f9f9; padding: 15px; border-radius: 6px; border-left: 4px solid #999; }
    .stat.pass { border-left-color: #22c55e; }
    .stat.fail { border-left-color: #ef4444; }
    .stat label { display: block; font-size: 12px; color: #666; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat .value { font-size: 28px; font-weight: bold; color: #333; }
    h1 { margin-top: 0; color: #1f2937; }
    h2 { color: #374151; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; margin-top: 30px; }
    .scenarios { display: flex; flex-direction: column; gap: 20px; }
    .scenario { background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; }
    .scenario.pass { border-left: 4px solid #22c55e; }
    .scenario.fail { border-left: 4px solid #ef4444; }
    .scenario-header { padding: 15px 20px; background: #f9f9f9; display: flex; justify-content: space-between; align-items: center; }
    .scenario-title { font-weight: 600; color: #1f2937; }
    .scenario-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
    .badge-pass { background: #d1fae5; color: #065f46; }
    .badge-fail { background: #fee2e2; color: #991b1b; }
    .scenario-content { padding: 20px; }
    .issues-list { margin-top: 15px; }
    .issue-item { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin-bottom: 12px; border-radius: 4px; }
    .issue-kind { font-weight: 600; font-size: 12px; color: #b45309; text-transform: uppercase; }
    .issue-message { margin-top: 5px; color: #333; font-size: 14px; }
    .screenshot-container { margin-top: 15px; }
    .screenshot { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; margin-top: 10px; }
    .answer-sequence { background: #f3f4f6; padding: 12px; border-radius: 4px; font-family: monospace; font-size: 12px; overflow-x: auto; margin-top: 10px; }
    .no-issues { color: #6b7280; padding: 15px 0; }
    .completion-screenshot { margin-top: 15px; }
  `;

  const scenarioHtml = results
    .map((result) => {
      const issues = issuesByScenario.get(result.scenario.id) || [];
      const isPass = result.reachedCompletion && issues.length === 0;
      const statusBadge = `<span class="scenario-badge ${isPass ? 'badge-pass' : 'badge-fail'}">${isPass ? 'Pass' : 'Fail'}</span>`;

      let content = `<div class="scenario-content">
        <div><strong>Strategy:</strong> ${result.scenario.strategy}</div>
        <div><strong>Steps:</strong> ${result.stepResults.length}</div>
        <div><strong>Duration:</strong> ${result.durationMs}ms</div>`;

      if (result.fatalError) {
        content += `<div class="issues-list"><div class="issue-item"><div class="issue-kind">Fatal Error</div><div class="issue-message">${escapeHtml(result.fatalError)}</div></div></div>`;
      }

      if (issues.length > 0) {
        content += '<div class="issues-list">';
        for (const issue of issues) {
          content += `<div class="issue-item"><div class="issue-kind">${issue.kind}</div><div class="issue-message">${escapeHtml(issue.message)}</div>`;

          const stepResult = result.stepResults.find((sr) => sr.step.variableRef === (issue.detail as any)?.variableRef);
          if (stepResult?.screenshotBase64) {
            content += `<div class="screenshot-container"><img class="screenshot" src="data:image/png;base64,${stepResult.screenshotBase64}" alt="Error screenshot"></div>`;
          }

          content += '</div>';
        }
        content += '</div>';
      } else if (result.reachedCompletion) {
        content += '<div class="no-issues">✓ No issues found</div>';
        if (result.completionScreenshot) {
          content += `<div class="completion-screenshot"><strong>Completion Screen:</strong><div><img class="screenshot" src="data:image/png;base64,${result.completionScreenshot}" alt="Completion screen"></div></div>`;
        }
      }

      // Answer sequence for debugging
      const answerSeq = result.stepResults
        .filter((sr) => sr.strategy.kind !== 'skip')
        .map((sr) => `${sr.step.variableRef}=${String(sr.step.value).slice(0, 30)}`)
        .join(', ');
      if (answerSeq) {
        content += `<div class="answer-sequence">Answers: ${answerSeq}</div>`;
      }

      content += '</div>';

      return `<div class="scenario ${isPass ? 'pass' : 'fail'}">
        <div class="scenario-header">
          <div class="scenario-title">${escapeHtml(result.scenario.id)}</div>
          ${statusBadge}
        </div>
        ${content}
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Questionnaire Bot Report</title>
  <style>${css}</style>
</head>
<body>
  <div class="header">
    <h1>Questionnaire Bot Test Report</h1>
    <div class="stats">
      <div class="stat pass">
        <label>Pass Rate</label>
        <div class="value">${passRate}%</div>
      </div>
      <div class="stat pass">
        <label>Completed</label>
        <div class="value">${report.completedScenarios}/${report.totalScenarios}</div>
      </div>
      <div class="stat fail">
        <label>Issues Found</label>
        <div class="value">${report.issues.length}</div>
      </div>
      <div class="stat">
        <label>Duration</label>
        <div class="value">${(report.durationMs / 1000).toFixed(1)}s</div>
      </div>
    </div>
  </div>

  <h2>Scenarios</h2>
  <div class="scenarios">
    ${scenarioHtml}
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, (char) => map[char] || char);
}
