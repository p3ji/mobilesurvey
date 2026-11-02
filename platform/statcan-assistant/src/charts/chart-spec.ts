/**
 * Vega-Lite Specification Compiler (Zero-Eval Safe)
 */

import type { ChartIntent, ObservationRow } from '../types.js';

export function buildVegaLiteSpec(
  rows: ObservationRow[],
  chart: ChartIntent,
  containerTitle?: string
): Record<string, any> {
  const title = chart.title || containerTitle || 'Statistics Canada';
  const xField = chart.x || 'period';
  const yField = chart.y || 'value';

  if (chart.type === 'line') {
    return {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      title: { text: title, fontSize: 14, anchor: 'start' },
      data: { values: rows },
      mark: { type: 'line', point: true, tooltip: true },
      encoding: {
        x: {
          field: xField,
          type: 'nominal',
          axis: { title: chart.x_label || 'Period', labelAngle: -45 },
        },
        y: {
          field: yField,
          type: 'quantitative',
          axis: { title: chart.y_label || 'Value' },
          scale: { zero: false },
        },
        ...(chart.series
          ? {
              color: {
                field: chart.series,
                type: 'nominal',
                legend: { title: chart.series.replace(/_/g, ' ') },
              },
            }
          : {}),
      },
      width: 'container',
      height: 320,
    };
  }

  if (chart.type === 'bar') {
    return {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      title: { text: title, fontSize: 14, anchor: 'start' },
      data: { values: rows },
      mark: { type: 'bar', tooltip: true },
      encoding: {
        x: {
          field: xField,
          type: 'nominal',
          axis: { title: chart.x_label || 'Category', labelAngle: -45 },
          sort: chart.sort === 'descending' ? '-y' : chart.sort === 'ascending' ? 'y' : undefined,
        },
        y: {
          field: yField,
          type: 'quantitative',
          axis: { title: chart.y_label || 'Value' },
          scale: { zero: true },
        },
        ...(chart.series
          ? {
              color: {
                field: chart.series,
                type: 'nominal',
                legend: { title: chart.series.replace(/_/g, ' ') },
              },
            }
          : {}),
      },
      width: 'container',
      height: 320,
    };
  }

  if (chart.type === 'scatter') {
    return {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      title: { text: title, fontSize: 14, anchor: 'start' },
      data: { values: rows },
      mark: { type: 'circle', size: 60, tooltip: true },
      encoding: {
        x: {
          field: xField,
          type: 'quantitative',
          axis: { title: chart.x_label || xField },
        },
        y: {
          field: yField,
          type: 'quantitative',
          axis: { title: chart.y_label || yField },
        },
        ...(chart.series
          ? {
              color: {
                field: chart.series,
                type: 'nominal',
                legend: { title: chart.series },
              },
            }
          : {}),
      },
      width: 'container',
      height: 320,
    };
  }

  // Fallback default
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    title: { text: title, fontSize: 14, anchor: 'start' },
    data: { values: rows },
    mark: { type: 'line', point: true, tooltip: true },
    encoding: {
      x: { field: xField, type: 'nominal' },
      y: { field: yField, type: 'quantitative' },
    },
    width: 'container',
    height: 320,
  };
}
