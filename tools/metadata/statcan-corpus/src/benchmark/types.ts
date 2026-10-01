export type BenchmarkCategory =
  | 'theme_content'
  | 'exact_mnemonic'
  | 'historical_term'
  | 'colloquial'
  | 'noise_hazard'
  | 'cross_lingual'
  | 'control';

export interface BenchmarkQuery {
  id: string;
  query: string;
  category: BenchmarkCategory;
  theme?: string;
  description: string;
  expectedMinHits?: number;
  expectedTopTerms?: string[];
  expectedExactName?: string;
  noiseTermsToAvoid?: string[];
  notes?: string;
}

export interface QueryMethodResult {
  methodName: string;
  latencyMs: number;
  totalHits: number;
  topHits: Array<{
    name: string;
    concept: string | null;
    questionText: string | null;
    score: number;
  }>;
  exactHitAtRank1?: boolean;
  precisionAt5?: number; // fraction of top 5 containing expected terms
  noisePolluted?: boolean;
}

export interface BenchmarkEvaluationReport {
  timestamp: string;
  totalQueries: number;
  methods: string[];
  summary: Record<string, {
    avgLatencyMs: number;
    p95LatencyMs: number;
    exactMnemonicAccuracy: number; // percentage (0 - 100)
    zeroResultCount: number;
    controlFalsePositiveCount: number;
    avgPrecisionAt5: number; // percentage (0 - 100)
  }>;
  queryDetails: Array<{
    queryId: string;
    query: string;
    category: BenchmarkCategory;
    theme?: string;
    resultsByMethod: Record<string, QueryMethodResult>;
  }>;
}
