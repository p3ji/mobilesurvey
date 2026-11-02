/**
 * Agent Tool Declarations and Pre-flight Guardrails
 */


export const STATCAN_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_statcan',
      description: 'Search Statistics Canada catalogue for tables and indicators by keyword or product ID.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Topic, indicator, survey, or product ID (e.g. "labour force", "cpi", "14100287").',
          },
          limit: {
            type: 'integer',
            description: 'Max candidate tables to return (default 6, max 12).',
            default: 6,
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_dimensions',
      description: 'Inspect dimensions, classification codelists, and member IDs for a specific StatCan table without downloading observations.',
      parameters: {
        type: 'object',
        properties: {
          productId: {
            type: 'integer',
            description: 'The 8-digit or 10-digit StatCan product ID / cube ID (e.g. 14100287).',
          },
          matches: {
            type: 'array',
            items: { type: 'string' },
            description: 'Labels or category names to search for among dimension members (e.g. ["Ontario", "Unemployment rate"]).',
          },
        },
        required: ['productId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_statcan',
      description: 'Fetch bounded observations from a StatCan table using dimension coordinates or vector IDs.',
      parameters: {
        type: 'object',
        properties: {
          productId: {
            type: 'integer',
            description: 'StatCan product ID (e.g. 14100287).',
          },
          coordinate: {
            type: 'string',
            description: 'StatCan dot-separated coordinate string corresponding to member IDs across dimensions (e.g. "1.1.1.1.0.0.0.0.0.0").',
          },
          latestN: {
            type: 'integer',
            description: 'Number of latest reference periods to retrieve (1 to 24).',
            default: 5,
          },
        },
        required: ['productId', 'coordinate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'publish_result',
      description: 'Select the primary observation table to publish and specify the analytical chart configuration.',
      parameters: {
        type: 'object',
        properties: {
          resultId: {
            type: 'string',
            description: 'ID of the fetch result or "context" to re-chart existing rows.',
          },
          chart: {
            type: 'object',
            properties: {
              purpose: {
                type: 'string',
                enum: ['trend', 'comparison', 'relationship', 'distribution', 'composition', 'change'],
              },
              type: {
                type: 'string',
                enum: ['line', 'bar', 'scatter', 'heatmap', 'histogram', 'box', 'area', 'none'],
              },
              x: { type: 'string', description: 'Column name for x-axis' },
              y: { type: 'string', description: 'Column name for y-axis' },
              series: { type: 'string', description: 'Optional dimension column for grouping lines/bars' },
              title: { type: 'string', description: 'Neutral, reader-facing title' },
              x_label: { type: 'string' },
              y_label: { type: 'string' },
              sort: { type: 'string', enum: ['ascending', 'descending', 'none'] },
            },
            required: ['purpose', 'type'],
          },
        },
        required: ['resultId'],
      },
    },
  },
];

/**
 * Validate that estimated observation cell count does not blow up limits.
 */
export function validateCellEstimate(
  dimensionMemberCounts: number[],
  latestN: number,
  maxCells = 50000
): { valid: boolean; estimatedCells: number; error?: string } {
  let cells = latestN;
  for (const count of dimensionMemberCounts) {
    if (count > 0) {
      cells *= count;
    }
  }

  if (cells > maxCells) {
    return {
      valid: false,
      estimatedCells: cells,
      error: `Query is too broad (estimated ${cells} cells; limit ${maxCells}). Apply specific dimension filters.`,
    };
  }

  return { valid: true, estimatedCells: cells };
}
