/**
 * Report formatting for discovery mode. Kept separate from `reporter.ts` (schema-guided mode)
 * because the underlying result shape is different — one exploratory run over a sequence of
 * pages, not many independent Scenarios — but the visual language (stat grid, issue cards,
 * screenshots) intentionally matches so both report kinds feel like the same tool.
 */
import type { DiscoveryIssue, DiscoveryRunResult } from './types.js';

export interface DiscoveryReport {
  pagesVisited: number;
  totalFieldsDiscovered: number;
  totalFieldsAnswered: number;
  reachedEnd: boolean;
  issues: DiscoveryIssue[];
  durationMs: number;
}

export function buildDiscoveryReport(result: DiscoveryRunResult): DiscoveryReport {
  const issues = [...result.issues];
  if (result.fatalError) {
    issues.unshift({
      kind: 'FATAL_ERROR',
      pageIndex: result.visits.length,
      message: `Discovery run failed: ${result.fatalError}`,
    });
  }

  return {
    pagesVisited: result.visits.length,
    totalFieldsDiscovered: result.visits.reduce((sum, v) => sum + v.fieldsDiscovered, 0),
    totalFieldsAnswered: result.visits.reduce((sum, v) => sum + v.fieldsAnswered, 0),
    reachedEnd: result.reachedEnd,
    issues,
    durationMs: result.durationMs,
  };
}

export function formatDiscoveryReportText(report: DiscoveryReport): string {
  const lines: string[] = [];
  lines.push(
    `Discovery Report: ${report.pagesVisited} page(s) visited, ` +
      `${report.totalFieldsAnswered}/${report.totalFieldsDiscovered} field(s) answered, ` +
      `${report.reachedEnd ? 'reached end' : 'did not reach end'} ` +
      `(${report.issues.length} issue${report.issues.length === 1 ? '' : 's'}, ${report.durationMs}ms)`,
  );
  if (report.issues.length === 0) {
    lines.push('No issues found.');
    return lines.join('\n');
  }
  for (const issue of report.issues) {
    lines.push(`  [${issue.kind}] page ${issue.pageIndex}: ${issue.message}`);
  }
  return lines.join('\n');
}

export function formatDiscoveryReportHtml(report: DiscoveryReport, result: DiscoveryRunResult): string {
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
    .pages { display: flex; flex-direction: column; gap: 20px; }
    .page-card { background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; border-left: 4px solid #999; }
    .page-header { padding: 15px 20px; background: #f9f9f9; }
    .page-title { font-weight: 600; color: #1f2937; }
    .page-url { font-size: 12px; color: #6b7280; word-break: break-all; }
    .page-content { padding: 20px; }
    .issues-list { margin-top: 15px; }
    .issue-item { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin-bottom: 12px; border-radius: 4px; }
    .issue-kind { font-weight: 600; font-size: 12px; color: #b45309; text-transform: uppercase; }
    .issue-message { margin-top: 5px; color: #333; font-size: 14px; }
    .screenshot { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; margin-top: 10px; }
    .no-issues { color: #6b7280; padding: 15px 0; }
  `;

  const issuesByPage = new Map<number, DiscoveryIssue[]>();
  for (const issue of report.issues) {
    if (!issuesByPage.has(issue.pageIndex)) issuesByPage.set(issue.pageIndex, []);
    issuesByPage.get(issue.pageIndex)!.push(issue);
  }

  const pageCards = result.visits
    .map((visit) => {
      const issuesHere = issuesByPage.get(visit.pageIndex) ?? [];
      let content = `<div class="page-content">
        <div><strong>Fields discovered:</strong> ${visit.fieldsDiscovered}</div>
        <div><strong>Fields answered:</strong> ${visit.fieldsAnswered}</div>`;

      if (issuesHere.length > 0) {
        content += '<div class="issues-list">';
        for (const issue of issuesHere) {
          content += `<div class="issue-item"><div class="issue-kind">${escapeHtml(issue.kind)}</div><div class="issue-message">${escapeHtml(issue.message)}</div></div>`;
        }
        content += '</div>';
      } else {
        content += '<div class="no-issues">✓ No issues on this page</div>';
      }

      if (visit.screenshotBase64) {
        content += `<div><img class="screenshot" src="data:image/png;base64,${visit.screenshotBase64}" alt="Page ${visit.pageIndex} screenshot"></div>`;
      }

      content += '</div>';

      return `<div class="page-card">
        <div class="page-header">
          <div class="page-title">Page ${visit.pageIndex}</div>
          <div class="page-url">${escapeHtml(visit.url)}</div>
        </div>
        ${content}
      </div>`;
    })
    .join('');

  const remainingIssues = report.issues.filter((i) => !result.visits.some((v) => v.pageIndex === i.pageIndex));
  const remainingHtml =
    remainingIssues.length > 0
      ? `<div class="page-card"><div class="page-header"><div class="page-title">Run-level issues</div></div><div class="page-content"><div class="issues-list">${remainingIssues
          .map(
            (issue) =>
              `<div class="issue-item"><div class="issue-kind">${escapeHtml(issue.kind)}</div><div class="issue-message">${escapeHtml(issue.message)}</div></div>`,
          )
          .join('')}</div></div></div>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Questionnaire Bot Discovery Report</title>
  <style>${css}</style>
</head>
<body>
  <div class="header">
    <h1>Questionnaire Bot Discovery Report</h1>
    <div class="stats">
      <div class="stat ${report.reachedEnd ? 'pass' : 'fail'}">
        <label>Reached End</label>
        <div class="value">${report.reachedEnd ? 'Yes' : 'No'}</div>
      </div>
      <div class="stat pass">
        <label>Pages Visited</label>
        <div class="value">${report.pagesVisited}</div>
      </div>
      <div class="stat ${report.issues.length > 0 ? 'fail' : 'pass'}">
        <label>Issues Found</label>
        <div class="value">${report.issues.length}</div>
      </div>
      <div class="stat">
        <label>Duration</label>
        <div class="value">${(report.durationMs / 1000).toFixed(1)}s</div>
      </div>
    </div>
    ${
      result.completionScreenshot
        ? `<div><strong>Completion Screen:</strong><div><img class="screenshot" src="data:image/png;base64,${result.completionScreenshot}" alt="Completion screen"></div></div>`
        : ''
    }
  </div>

  <h2>Pages</h2>
  <div class="pages">
    ${pageCards}
    ${remainingHtml}
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, (char) => map[char] || char);
}
