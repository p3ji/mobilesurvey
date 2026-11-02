import { describe, it, expect } from 'vitest';
import { buildVegaLiteSpec } from '../src/charts/chart-spec.js';
import type { ChartIntent, ObservationRow } from '../src/types.js';

describe('Vega-Lite Specification Compiler', () => {
  const mockRows: ObservationRow[] = [
    { period: '2024-01', value: 100, geography: 'Ontario' },
    { period: '2024-02', value: 105, geography: 'Ontario' },
  ];

  it('compiles a safe line chart specification', () => {
    const intent: ChartIntent = {
      purpose: 'trend',
      type: 'line',
      x: 'period',
      y: 'value',
      series: 'geography',
      title: 'Monthly Trend',
    };

    const spec = buildVegaLiteSpec(mockRows, intent);

    expect(spec.$schema).toContain('vega-lite');
    expect(spec.mark.type).toBe('line');
    expect(spec.encoding.x.field).toBe('period');
    expect(spec.encoding.y.field).toBe('value');
    expect(spec.encoding.color.field).toBe('geography');
    expect(spec.data.values.length).toBe(2);
  });

  it('compiles a bar chart specification with baseline zero', () => {
    const intent: ChartIntent = {
      purpose: 'comparison',
      type: 'bar',
      x: 'geography',
      y: 'value',
      sort: 'descending',
    };

    const spec = buildVegaLiteSpec(mockRows, intent);

    expect(spec.mark.type).toBe('bar');
    expect(spec.encoding.y.scale.zero).toBe(true);
    expect(spec.encoding.x.sort).toBe('-y');
  });

  it('compiles a scatter specification for pairwise correlation', () => {
    const intent: ChartIntent = {
      purpose: 'relationship',
      type: 'scatter',
      x: 'gdp',
      y: 'emissions',
    };

    const spec = buildVegaLiteSpec(mockRows, intent);

    expect(spec.mark.type).toBe('circle');
    expect(spec.encoding.x.field).toBe('gdp');
    expect(spec.encoding.y.field).toBe('emissions');
  });
});
