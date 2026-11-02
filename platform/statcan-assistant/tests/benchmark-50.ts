/**
 * 50-Question Benchmark Suite for StatCan Assistant
 * Evaluates discovery, dimension inspection, coordinate compilation, WDS slicing,
 * Gate 0 filtering, zero-numeral contract compliance, and Vega-Lite chart generation.
 */

import { StatCanWdsClient } from '../src/engine/statcan-wds.js';
import { StatCanAgentRunner } from '../src/agent/agent-runner.js';
import { buildVegaLiteSpec } from '../src/charts/chart-spec.js';
import { checkBareNumerals } from '../src/engine/fact-binder.js';

interface BenchmarkResult {
  index: number;
  domain: string;
  query: string;
  success: boolean;
  productId?: number;
  tableTitle?: string;
  coordinate?: string;
  rowsCount?: number;
  sampleValue?: string;
  gateZeroClean?: boolean;
  caveats?: string[];
  zeroNumeralValid?: boolean;
  chartMark?: string;
  durationMs: number;
  error?: string;
}

const TEST_QUESTIONS: Array<{ domain: string; query: string }> = [
  // 1. Labour Force & Employment
  { domain: 'Labour', query: 'unemployment rate' },
  { domain: 'Labour', query: 'employment by industry' },
  { domain: 'Labour', query: 'youth unemployment' },
  { domain: 'Labour', query: 'average hourly wages' },
  { domain: 'Labour', query: 'part-time employment' },
  { domain: 'Labour', query: 'labour force participation' },

  // 2. Prices & Inflation (CPI)
  { domain: 'Prices', query: 'consumer price index' },
  { domain: 'Prices', query: 'food inflation' },
  { domain: 'Prices', query: 'shelter cost index' },
  { domain: 'Prices', query: 'gasoline prices' },
  { domain: 'Prices', query: 'services inflation' },

  // 3. Economy & GDP
  { domain: 'Economy', query: 'gross domestic product' },
  { domain: 'Economy', query: 'monthly real gdp' },
  { domain: 'Economy', query: 'capital expenditure' },
  { domain: 'Economy', query: 'corporate operating profit' },
  { domain: 'Economy', query: 'manufacturing sales' },

  // 4. Population & Demographics
  { domain: 'Demographics', query: 'population estimates' },
  { domain: 'Demographics', query: 'international immigration' },
  { domain: 'Demographics', query: 'interprovincial migration' },
  { domain: 'Demographics', query: 'births and fertility' },
  { domain: 'Demographics', query: 'median age' },

  // 5. Housing & Construction
  { domain: 'Housing', query: 'housing starts' },
  { domain: 'Housing', query: 'new housing price index' },
  { domain: 'Housing', query: 'building permits' },
  { domain: 'Housing', query: 'household size dwelling' },
  { domain: 'Housing', query: 'residential property price' },

  // 6. Retail & Wholesale Trade
  { domain: 'Trade', query: 'retail trade sales' },
  { domain: 'Trade', query: 'e-commerce retail' },
  { domain: 'Trade', query: 'wholesale trade sales' },
  { domain: 'Trade', query: 'new motor vehicle sales' },

  // 7. International Trade & Travel
  { domain: 'International', query: 'merchandise exports' },
  { domain: 'International', query: 'merchandise imports' },
  { domain: 'International', query: 'international travel visitors' },
  { domain: 'International', query: 'canadian residents returning travel' },

  // 8. Health & Well-being
  { domain: 'Health', query: 'life expectancy' },
  { domain: 'Health', query: 'mental health status' },
  { domain: 'Health', query: 'hospital inpatient stays' },
  { domain: 'Health', query: 'smoking prevalence' },

  // 9. Energy & Environment
  { domain: 'Energy', query: 'greenhouse gas emissions' },
  { domain: 'Energy', query: 'electricity generation' },
  { domain: 'Energy', query: 'crude oil production' },
  { domain: 'Energy', query: 'renewable energy' },

  // 10. Education & Skills
  { domain: 'Education', query: 'postsecondary enrolment' },
  { domain: 'Education', query: 'undergraduate tuition fees' },
  { domain: 'Education', query: 'educational attainment' },
  { domain: 'Education', query: 'apprenticeship completion' },

  // 11. Justice & Safety
  { domain: 'Justice', query: 'crime severity index' },
  { domain: 'Justice', query: 'homicide rates' },

  // 12. Agriculture & Food
  { domain: 'Agriculture', query: 'farm cash receipts' },
  { domain: 'Agriculture', query: 'field crop production' },
];

async function runBenchmark() {
  console.log(`Starting StatCan Assistant 50-Question Benchmark...`);
  console.log(`-----------------------------------------------------`);

  const runner = new StatCanAgentRunner();
  const results: BenchmarkResult[] = [];

  for (let i = 0; i < TEST_QUESTIONS.length; i++) {
    const item = TEST_QUESTIONS[i]!;
    const start = Date.now();
    process.stdout.write(`[${i + 1}/50] Testing "${item.query}" (${item.domain})... `);

    try {
      const outcome = await runner.run(item.query);
      const durationMs = Date.now() - start;

      if (!outcome.result || outcome.result.rows.length === 0) {
        console.log(`FAILED: No rows returned`);
        results.push({
          index: i + 1,
          domain: item.domain,
          query: item.query,
          success: false,
          durationMs,
          error: 'No rows returned',
        });
        continue;
      }

      const res = outcome.result;
      const firstRow = res.rows[0];
      const sampleVal = firstRow?.value != null ? `${firstRow.value.toLocaleString()} (${firstRow.scaleFactorDesc || ''})` : 'None';

      // Verify Zero-Numeral Contract
      const zeroNumeralValid = outcome.zeroNumeralCompliant;

      // Verify Vega-Lite compilation
      const spec = res.chart ? buildVegaLiteSpec(res.rows, res.chart, res.dataset.title) : null;

      console.log(`SUCCESS (PID ${res.dataset.productId}, ${res.rows.length} rows, ${durationMs}ms)`);

      results.push({
        index: i + 1,
        domain: item.domain,
        query: item.query,
        success: true,
        productId: res.dataset.productId,
        tableTitle: res.dataset.title,
        coordinate: res.provenance.coordinate,
        rowsCount: res.rows.length,
        sampleValue: sampleVal,
        gateZeroClean: (res.warnings || []).length === 0,
        caveats: res.warnings || [],
        zeroNumeralValid,
        chartMark: spec?.mark?.type || 'none',
        durationMs,
      });
    } catch (err: any) {
      const durationMs = Date.now() - start;
      console.log(`ERROR: ${err.message}`);
      results.push({
        index: i + 1,
        domain: item.domain,
        query: item.query,
        success: false,
        durationMs,
        error: err.message,
      });
    }
  }

  // Summary Metrics
  const total = results.length;
  const passed = results.filter((r) => r.success).length;
  const zeroNumeralPassed = results.filter((r) => r.zeroNumeralValid).length;
  const avgDuration = Math.round(results.reduce((acc, r) => acc + r.durationMs, 0) / total);

  console.log(`\n================ BENCHMARK REPORT ================`);
  console.log(`Total Questions:         ${total}`);
  console.log(`Successful Retrievals:   ${passed} / ${total} (${Math.round((passed / total) * 100)}%)`);
  console.log(`Zero-Numeral Compliance: ${zeroNumeralPassed} / ${passed}`);
  console.log(`Average Latency:         ${avgDuration} ms`);
  console.log(`==================================================\n`);

  // Write JSON artifact
  const fs = await import('fs');
  fs.writeFileSync('benchmark_results.json', JSON.stringify(results, null, 2));
}

runBenchmark().catch(console.error);
