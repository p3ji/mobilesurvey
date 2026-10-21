#!/usr/bin/env node
/**
 * @mobilesurvey/cognitive-lab — CLI Entrypoint.
 *
 * Usage:
 *   npx @mobilesurvey/cognitive-lab start [--port 8792] [--url <questionnaire-url>]
 *   npx @mobilesurvey/cognitive-lab demo-report
 */

import { buildPlaywrightObserverInitScript, startCognitiveLabDaemon } from './daemon.js';
import { createLfsCognitiveSessionP01 } from './fixtures.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subcmd = args[0] ?? 'start';

  if (subcmd === 'demo-report') {
    const session = createLfsCognitiveSessionP01();
    console.log(JSON.stringify(session, null, 2));
    return;
  }

  let port = 8792;
  let targetUrl: string | null = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = Number(args[i + 1]) || 8792;
      i++;
    } else if (args[i] === '--url' && args[i + 1]) {
      targetUrl = args[i + 1] ?? null;
      i++;
    }
  }

  const daemon = await startCognitiveLabDaemon({ port });
  console.log(`\n🎙️  Cognitive Testing Lab Local Daemon listening at ${daemon.url}`);
  console.log(`   • Acoustic Prosody DSP : YIN/Autocorrelation F0 + RMS dBFS + VAD Pause Tracker`);
  console.log(`   • Disfluency & Affect  : Bilingual EN/FR Filled-Pause & Incongruence Engine`);
  console.log(`   • Zero-Cloud Privacy   : Raw audio restricted to 127.0.0.1; PII surrogates active`);
  console.log(`   • Open Hub Console     : http://localhost:5175/#coglab\n`);

  if (targetUrl) {
    try {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: false });
      const context = await browser.newContext();
      await context.addInitScript(buildPlaywrightObserverInitScript(daemon.url));
      const page = await context.newPage();
      console.log(`🌐 Launched instrumented questionnaire window -> ${targetUrl}`);
      await page.goto(targetUrl);
    } catch (err) {
      console.warn(
        `Could not launch Playwright window automatically (${err instanceof Error ? err.message : String(err)}). Daemon remains active.`,
      );
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
