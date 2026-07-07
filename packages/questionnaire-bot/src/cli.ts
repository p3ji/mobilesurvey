#!/usr/bin/env node
/**
 * CLI entry point for the Questionnaire Tester bot.
 * Runs scenarios against a respondent runtime and generates reports.
 *
 * Usage: npx questionnaire-bot --url http://localhost:5174/?survey=demo --strategy coverage --report html --output report.html
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { demoInstrument } from '@mobilesurvey/instrument-schema';
import { enumeratePaths } from './enumerator.js';
import { runScenarios } from './runner.js';
import { buildReport, formatReportText, formatReportHtml } from './reporter.js';

interface CliOptions {
  url: string;
  instrument?: string;
  strategy: 'all-paths' | 'coverage' | 'boundary';
  language?: string;
  maxPaths?: number;
  report: 'json' | 'text' | 'html';
  output?: string;
  headless?: boolean;
  screenshots?: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: Record<string, any> = {
    strategy: 'coverage',
    report: 'text',
    headless: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--url' && args[i + 1]) {
      opts.url = args[++i];
    } else if (arg === '--instrument' && args[i + 1]) {
      opts.instrument = args[++i];
    } else if (arg === '--strategy' && args[i + 1]) {
      opts.strategy = args[++i];
    } else if (arg === '--language' && args[i + 1]) {
      opts.language = args[++i];
    } else if (arg === '--max-paths' && args[i + 1]) {
      opts.maxPaths = parseInt(args[++i]!, 10);
    } else if (arg === '--report' && args[i + 1]) {
      opts.report = args[++i];
    } else if (arg === '--output' && args[i + 1]) {
      opts.output = args[++i];
    } else if (arg === '--no-headless') {
      opts.headless = false;
    } else if (arg === '--screenshots') {
      opts.screenshots = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!opts.url) {
    console.error('Error: --url is required');
    printHelp();
    process.exit(1);
  }

  return opts as CliOptions;
}

function printHelp(): void {
  console.log(`
Questionnaire Bot — Automated questionnaire testing

Usage:
  questionnaire-bot --url <url> [options]

Options:
  --url <url>              URL of the respondent runtime (required)
  --instrument <name>      Instrument to test (default: demo)
  --strategy <strategy>    Coverage strategy: all-paths, coverage, boundary (default: coverage)
  --language <lang>        Language code (default: en)
  --max-paths <n>          Maximum paths to enumerate (default: 200 for coverage, 50 for boundary)
  --report <format>        Report format: json, text, html (default: text)
  --output <file>          Output file (default: stdout for text/json, report.html for html)
  --screenshots            Capture screenshots for failed steps and completion
  --no-headless            Run browser in headed mode
  --help, -h               Show this help message

Examples:
  # Test the demo survey with default settings (coverage strategy, text report)
  questionnaire-bot --url http://localhost:5174/?survey=demo

  # Generate an HTML report with screenshots
  questionnaire-bot --url http://localhost:5174/?survey=demo --report html --screenshots --output report.html

  # Comprehensive testing with all-paths strategy
  questionnaire-bot --url http://localhost:5174/?survey=demo --strategy all-paths --max-paths 1000 --report html --screenshots
`);
}

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log(`Questionnaire Bot v1.0.0`);
  console.log(`Connecting to: ${opts.url}`);
  console.log(`Strategy: ${opts.strategy}, Report: ${opts.report}`);

  // For now, we use the demo instrument bundled in the schema.
  // A real CLI would support loading from files or other instruments.
  const instrument = demoInstrument;

  const language = (opts.language ?? 'en') as any;

  console.log(`Enumerating paths...`);
  const scenarios = enumeratePaths(instrument, {
    strategy: opts.strategy,
    language,
    ...(opts.maxPaths !== undefined && { maxPaths: opts.maxPaths }),
  });

  console.log(`Found ${scenarios.length} scenario(s). Running tests...`);
  const results = await runScenarios(instrument, scenarios, {
    url: opts.url,
    language,
    headless: opts.headless,
    captureScreenshots: opts.screenshots,
  });

  const report = buildReport(results);
  let output: string;

  if (opts.report === 'json') {
    output = JSON.stringify(report, null, 2);
  } else if (opts.report === 'html') {
    output = formatReportHtml(report, results);
  } else {
    output = formatReportText(report);
  }

  // Write output
  if (opts.output) {
    const filepath = resolve(opts.output);
    writeFileSync(filepath, output, 'utf-8');
    console.log(`\nReport written to: ${filepath}`);
  } else if (opts.report === 'html') {
    const filepath = resolve('report.html');
    writeFileSync(filepath, output, 'utf-8');
    console.log(`\nReport written to: ${filepath}`);
  } else {
    console.log(`\n${output}`);
  }

  // Exit with appropriate code
  process.exit(report.issues.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
