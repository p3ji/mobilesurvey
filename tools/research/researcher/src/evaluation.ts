export interface GoldClaim {
  program: string;
  role: 'analyzed' | 'comparison' | 'background_mention';
  precision?: 'exact_cycles' | 'range' | 'program_only';
  exactCycles?: string[];
}

export interface GoldRecord {
  id: string; // doi:... or url:...
  title?: string;
  claims: GoldClaim[];
  primaryTheme?: string | null;
}

export interface MetricCount {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface EvaluationReport {
  totalGoldWorks: number;
  totalExtractedWorks: number;
  evaluatedWorks: number;
  programMetric: MetricCount;
  roleMetric: MetricCount;
  exactCycleMatches: { matched: number; total: number; accuracy: number };
  themeMatches: { matched: number; total: number; accuracy: number };
  mismatches: Array<{
    workId: string;
    reason: string;
    gold?: any;
    extracted?: any;
  }>;
}

function calcMetric(tp: number, fp: number, fn: number): MetricCount {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, precision: Number(precision.toFixed(3)), recall: Number(recall.toFixed(3)), f1: Number(f1.toFixed(3)) };
}

export function evaluateExtractionAgainstGold(
  goldRecords: GoldRecord[],
  extractedWorks: Array<{ id: string; claims: any[]; themes?: any[] }>
): EvaluationReport {
  const extractedMap = new Map(extractedWorks.map(w => [w.id, w]));
  let progTp = 0, progFp = 0, progFn = 0;
  let roleTp = 0, roleFp = 0, roleFn = 0;
  let cycleMatched = 0, cycleTotal = 0;
  let themeMatched = 0, themeTotal = 0;
  const mismatches: EvaluationReport['mismatches'] = [];

  for (const gold of goldRecords) {
    const extracted = extractedMap.get(gold.id);
    if (!extracted) {
      progFn += gold.claims.length;
      roleFn += gold.claims.length;
      mismatches.push({ workId: gold.id, reason: 'Work not found in extracted results' });
      continue;
    }

    const extClaims = extracted.claims ?? [];
    const goldPrograms = new Set(gold.claims.map(c => c.program));
    const extPrograms = new Set(extClaims.map((c: any) => c.program));

    // Program evaluation
    for (const p of goldPrograms) {
      if (extPrograms.has(p)) progTp++;
      else {
        progFn++;
        mismatches.push({ workId: gold.id, reason: `Missing expected program ${p}` });
      }
    }
    for (const p of extPrograms) {
      if (!goldPrograms.has(p)) {
        progFp++;
        mismatches.push({ workId: gold.id, reason: `Unexpected extracted program ${p}` });
      }
    }

    // Role and cycle evaluation per matched claim
    for (const gc of gold.claims) {
      const match = extClaims.find((ec: any) => ec.program === gc.program);
      if (match) {
        if (match.role === gc.role) {
          roleTp++;
        } else {
          roleFp++;
          mismatches.push({
            workId: gold.id,
            reason: `Role mismatch for ${gc.program}: gold=${gc.role} vs ext=${match.role}`,
            gold: gc.role,
            extracted: match.role,
          });
        }

        if (gc.exactCycles && gc.exactCycles.length > 0) {
          cycleTotal++;
          const extCycles = Array.isArray(match.exactCycles) ? match.exactCycles : [];
          const sameCycles = gc.exactCycles.length === extCycles.length &&
            gc.exactCycles.every(c => extCycles.includes(c));
          if (sameCycles) cycleMatched++;
          else {
            mismatches.push({
              workId: gold.id,
              reason: `Cycle mismatch for ${gc.program}`,
              gold: gc.exactCycles,
              extracted: extCycles,
            });
          }
        }
      }
    }

    // Theme evaluation
    if (gold.primaryTheme) {
      themeTotal++;
      const extTheme = extracted.themes?.[0]?.primary;
      if (extTheme && extTheme.toLowerCase() === gold.primaryTheme.toLowerCase()) {
        themeMatched++;
      } else {
        mismatches.push({
          workId: gold.id,
          reason: 'Primary theme mismatch',
          gold: gold.primaryTheme,
          extracted: extTheme,
        });
      }
    }
  }

  return {
    totalGoldWorks: goldRecords.length,
    totalExtractedWorks: extractedWorks.length,
    evaluatedWorks: goldRecords.filter(g => extractedMap.has(g.id)).length,
    programMetric: calcMetric(progTp, progFp, progFn),
    roleMetric: calcMetric(roleTp, roleFp, roleFn),
    exactCycleMatches: {
      matched: cycleMatched,
      total: cycleTotal,
      accuracy: cycleTotal > 0 ? Number((cycleMatched / cycleTotal).toFixed(3)) : 1,
    },
    themeMatches: {
      matched: themeMatched,
      total: themeTotal,
      accuracy: themeTotal > 0 ? Number((themeMatched / themeTotal).toFixed(3)) : 1,
    },
    mismatches,
  };
}
