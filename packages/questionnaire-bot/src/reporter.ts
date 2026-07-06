/**
 * Turns a batch of ScenarioRunResults into a structured report: a machine-readable summary plus
 * a human-readable issue list. HTML/screenshot output is deferred to a later phase — this gives
 * CI-friendly JSON and a plain-text summary today.
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
