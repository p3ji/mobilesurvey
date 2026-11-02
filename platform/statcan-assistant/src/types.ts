/**
 * Type definitions for @mobilesurvey/statcan-assistant
 * Enhanced with Statistics Canada quality symbols and WatSPEED Remine verification metadata.
 */

export type StatCanQualitySymbol = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'x' | '';

export interface StatCanCubeSummary {
  productId: number;
  cubeTitleEn: string;
  cubeTitleFr?: string;
  releaseTime?: string;
  dimensionsEn?: string[];
  subjectCode?: string;
}

export interface DimensionMember {
  memberId: number;
  memberNameEn: string;
  parentMemberId?: number;
}

export interface DimensionMetadata {
  dimensionPositionId: number;
  dimensionNameEn: string;
  hasUom?: boolean;
  members: DimensionMember[];
}

export interface CubeMetadata {
  productId: number;
  cubeTitleEn: string;
  cubeTitleFr?: string;
  frequencyCode?: number;
  frequencyDescription?: string;
  startReferencePeriod?: string;
  endReferencePeriod?: string;
  dimensions: DimensionMetadata[];
}

export interface ObservationRow {
  period: string;
  value: number | null;
  rawValue?: number | null;
  scaleFactor?: number;
  scaleFactorDesc?: string;
  status?: StatCanQualitySymbol;
  qualityDesc?: string;
  isSuppressed?: boolean;
  isHighVariability?: boolean;
  vectorId?: number;
  coordinate?: string;
  decimals?: number;
  [dimensionKey: string]: string | number | boolean | null | undefined;
}

export interface FactToken {
  id: string; // e.g. "fact_1"
  period: string;
  value: number | null;
  formatted: string;
  metric: string;
  cut: Record<string, string>;
  vectorId?: number;
}

export interface ProvenanceMetadata {
  productId: number;
  title: string;
  coordinate: string;
  vectorIds: number[];
  frequency?: string;
  seasonalStatus?: 'Seasonally adjusted' | 'Unadjusted' | 'Unknown';
  tableUrl: string;
  wdsApiUrl: string;
  extractedAt: string;
  caveats: string[];
}

export interface ChartIntent {
  purpose: 'trend' | 'comparison' | 'relationship' | 'distribution' | 'composition' | 'change';
  type: 'line' | 'bar' | 'scatter' | 'heatmap' | 'histogram' | 'box' | 'area' | 'none';
  x?: string;
  y?: string;
  series?: string;
  title?: string;
  x_label?: string;
  y_label?: string;
  orientation?: 'vertical' | 'horizontal';
  sort?: 'ascending' | 'descending' | 'none';
}

export interface StructuredResult {
  dataset: {
    productId: number;
    title: string;
    updated?: string;
    sourceUrl: string;
  };
  provenance: ProvenanceMetadata;
  filters: Record<string, string[]>;
  columns: Array<{ key: string; label: string }>;
  rows: ObservationRow[];
  facts: FactToken[];
  chart?: ChartIntent;
  warnings?: string[];
}
