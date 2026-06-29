import type { Instrument } from '@mobilesurvey/instrument-schema';

export interface FidelityNote {
  severity: 'info' | 'warning' | 'approximation';
  elementId: string;
  message: string;
}

export interface FidelityReport {
  /** True when no warnings or approximations were recorded. */
  lossless: boolean;
  notes: FidelityNote[];
}

export interface ImportResult {
  instrument: Instrument;
  report: FidelityReport;
}
