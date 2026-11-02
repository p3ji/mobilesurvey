/**
 * Autonomous TypeScript ReAct Agent Runner for StatCan Assistant
 * Implements bounded tool loops, event streaming, context reuse, and zero-numeral verification.
 */

import { StatCanWdsClient } from '../engine/statcan-wds.js';
import { bindFactTokens, checkBareNumerals } from '../engine/fact-binder.js';
import { compileCoordinate } from '../engine/fuzzy-matcher.js';
import { STATCAN_AGENT_TOOLS } from './agent-tools.js';
import type { ChartIntent, ObservationRow, ProvenanceMetadata, StructuredResult } from '../types.js';

export interface AgentEvent {
  type: 'thought' | 'tool_call' | 'answer' | 'warning';
  phase?: 'started' | 'completed' | 'error';
  call?: {
    id: string;
    name: string;
    arguments: Record<string, any>;
    durationMs?: number;
    preview?: string;
  };
  content?: string;
}

export interface AgentRunnerOptions {
  model?: string;
  apiKey?: string;
  baseUrl?: string; // e.g. https://openrouter.ai/api/v1
  maxRounds?: number;
  onEvent?: (event: AgentEvent) => void;
}

export class StatCanAgentRunner {
  private client: StatCanWdsClient;
  private maxRounds: number;
  private apiKey?: string;
  private baseUrl: string;
  private model: string;
  private onEvent?: (event: AgentEvent) => void;

  constructor(options: AgentRunnerOptions = {}) {
    this.client = new StatCanWdsClient();
    this.maxRounds = options.maxRounds || 10;
    this.apiKey = options.apiKey || (typeof process !== 'undefined' ? process.env?.OPENROUTER_API_KEY : undefined);
    this.baseUrl = options.baseUrl || 'https://openrouter.ai/api/v1';
    this.model = options.model || 'meta-llama/llama-3.3-70b-instruct';
    this.onEvent = options.onEvent;
  }

  /**
   * Run the agent on a user prompt with memory of existing context.
   */
  async run(
    query: string,
    context?: {
      lastResult?: StructuredResult | null;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    }
  ): Promise<{
    answer: string;
    result?: StructuredResult | null;
    toolCallCount: number;
    zeroNumeralCompliant: boolean;
    warnings: string[];
  }> {
    const warnings: string[] = [];
    let toolCallCount = 0;
    let publishedResult: StructuredResult | null = null;
    let lastFetched: { rows: ObservationRow[]; title: string; provenance: ProvenanceMetadata; facts: any[]; caveats: string[] } | null = null;

    // Check if query is a pure chart/sorting follow-up on existing context
    if (context?.lastResult && this.isChartModificationOnly(query)) {
      const updatedChart = this.extractChartIntentFromQuery(query, context.lastResult.chart);
      publishedResult = {
        ...context.lastResult,
        chart: updatedChart,
      };
      return {
        answer: `Updated visualization to ${updatedChart.type} chart.`,
        result: publishedResult,
        toolCallCount: 0,
        zeroNumeralCompliant: true,
        warnings: [],
      };
    }

    // Direct deterministic execution path (used if no LLM key is configured, or as fallback)
    if (!this.apiKey) {
      return this.runDeterministicDiscovery(query);
    }

    // Full LLM ReAct tool loop
    const messages: any[] = [
      {
        role: 'system',
        content: `You are an official Statistics Canada data assistant. You answer questions using authoritative StatCan tables via your tools:
1. search_statcan: find table PIDs
2. inspect_dimensions: inspect codelists and member IDs
3. fetch_statcan: retrieve observation rows using dimension coordinates
4. publish_result: choose the final table and Vega-Lite chart type (trend, comparison, scatter)

CRITICAL RULES:
- Never invent numbers or bare digits freehand. Always reference data retrieved via tools.
- Choose 'Seasonally adjusted' when comparing monthly economic indicators over time.
- State the exact Table PID and coordinate in your conclusion.`,
      },
      ...(context?.history || []),
      { role: 'user', content: query },
    ];

    for (let round = 0; round < this.maxRounds; round++) {
      let response: any;
      try {
        response = await this.callLLM(messages);
      } catch (err: any) {
        warnings.push(`LLM call failed: ${err.message}. Falling back to deterministic engine.`);
        return this.runDeterministicDiscovery(query);
      }

      const choice = response.choices?.[0]?.message;
      if (!choice) break;

      const toolCalls = choice.tool_calls || [];

      if (toolCalls.length === 0) {
        // Final assistant narrative
        let finalAnswer = choice.content || '';
        // Zero-numeral check
        const numeralCheck = checkBareNumerals(finalAnswer);
        if (!numeralCheck.valid) {
          warnings.push(`Notice: Response contained bare numerals (${numeralCheck.bareNumerals.join(', ')}).`);
        }

        return {
          answer: finalAnswer,
          result: publishedResult,
          toolCallCount,
          zeroNumeralCompliant: numeralCheck.valid,
          warnings,
        };
      }

      // Execute tool calls
      messages.push(choice);

      for (const call of toolCalls) {
        toolCallCount++;
        const fnName = call.function.name;
        const args = JSON.parse(call.function.arguments || '{}');
        const startedAt = Date.now();

        this.emit({
          type: 'tool_call',
          phase: 'started',
          call: { id: call.id, name: fnName, arguments: args },
        });

        let toolOutputStr = '';

        try {
          if (fnName === 'search_statcan') {
            const matches = await this.client.search(args.query, args.limit || 5);
            toolOutputStr = JSON.stringify(matches);
          } else if (fnName === 'inspect_dimensions') {
            const insp = await this.client.inspectDimensions(args.productId, args.matches);
            toolOutputStr = JSON.stringify({
              productId: insp.metadata.productId,
              title: insp.metadata.cubeTitleEn,
              frequency: insp.metadata.frequencyDescription,
              dimensions: insp.metadata.dimensions.map((d) => ({
                id: d.dimensionPositionId,
                name: d.dimensionNameEn,
                membersCount: d.members.length,
                sampleMembers: d.members.slice(0, 15),
              })),
              matches: insp.matches,
            });
          } else if (fnName === 'fetch_statcan') {
            const fetchRes = await this.client.fetchSlice(args.productId, args.coordinate, args.latestN || 6);
            lastFetched = fetchRes;
            toolOutputStr = JSON.stringify({
              rowsCount: fetchRes.rows.length,
              rows: fetchRes.rows.slice(0, 25),
              caveats: fetchRes.caveats,
            });
          } else if (fnName === 'publish_result') {
            if (lastFetched) {
              publishedResult = {
                dataset: {
                  productId: lastFetched.provenance.productId,
                  title: lastFetched.title,
                  sourceUrl: lastFetched.provenance.tableUrl,
                },
                provenance: lastFetched.provenance,
                filters: {},
                columns: Object.keys(lastFetched.rows[0] || {}).map((k) => ({ key: k, label: k })),
                rows: lastFetched.rows,
                facts: lastFetched.facts,
                chart: args.chart,
                warnings: lastFetched.caveats,
              };
            }
            toolOutputStr = JSON.stringify({ status: 'published', chartType: args.chart?.type });
          }
        } catch (toolErr: any) {
          toolOutputStr = `ERROR: ${toolErr.message}`;
        }

        const durationMs = Date.now() - startedAt;
        this.emit({
          type: 'tool_call',
          phase: 'completed',
          call: {
            id: call.id,
            name: fnName,
            arguments: args,
            durationMs,
            preview: toolOutputStr.slice(0, 120),
          },
        });

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: toolOutputStr,
        });
      }
    }

    return {
      answer: 'Completed query lookup.',
      result: publishedResult,
      toolCallCount,
      warnings,
    };
  }

  /**
   * Deterministic Discovery Engine (runs when no LLM key is present or on API fallback).
   */
  private async runDeterministicDiscovery(query: string): Promise<{
    answer: string;
    result: StructuredResult | null;
    toolCallCount: number;
    warnings: string[];
  }> {
    const candidates = await this.client.search(query, 5);
    if (candidates.length === 0) {
      return {
        answer: `Could not find an official Statistics Canada table matching "${query}". Try searching for terms like "labour force", "cpi", or "population".`,
        result: null,
        toolCallCount: 1,
        warnings: [],
      };
    }

    const selectedCube = candidates[0]!;
    const { metadata } = await this.client.inspectDimensions(selectedCube.productId);

    // Default aggregate coordinate (10 parts)
    const defaultCoords = compileCoordinate(metadata);
    const fetchRes = await this.client.fetchSlice(selectedCube.productId, defaultCoords, 8);

    const chartIntent: ChartIntent = {
      purpose: 'trend',
      type: 'line',
      x: 'period',
      y: 'value',
      title: selectedCube.cubeTitleEn,
      x_label: 'Reference Period',
      y_label: fetchRes.rows[0]?.scaleFactorDesc !== 'Units' ? `Value (${fetchRes.rows[0]?.scaleFactorDesc})` : 'Value',
    };

    const result: StructuredResult = {
      dataset: {
        productId: selectedCube.productId,
        title: selectedCube.cubeTitleEn,
        sourceUrl: fetchRes.provenance.tableUrl,
      },
      provenance: fetchRes.provenance,
      filters: {},
      columns: Object.keys(fetchRes.rows[0] || {}).map((k) => ({ key: k, label: k })),
      rows: fetchRes.rows,
      facts: fetchRes.facts,
      chart: chartIntent,
      warnings: fetchRes.caveats,
    };

    // Zero-numeral template binding
    let narrative = '';
    if (fetchRes.facts.length >= 2) {
      const f1 = fetchRes.facts[0]!;
      const f2 = fetchRes.facts[fetchRes.facts.length - 1]!;
      narrative = `Between {{${f1.id}.period}} and {{${f2.id}.period}}, ${selectedCube.cubeTitleEn} moved from {{${f1.id}}} to {{${f2.id}}}.`;
    } else {
      narrative = `Retrieved observation records from ${selectedCube.cubeTitleEn}.`;
    }

    // Verify zero-numeral contract on the draft template BEFORE token substitution
    const numeralCheck = checkBareNumerals(narrative);

    const verifiedProse = bindFactTokens(narrative, fetchRes.facts);

    return {
      answer: `${verifiedProse}\n\nSource: [StatCan Table ${selectedCube.productId}](${fetchRes.provenance.tableUrl}) (Coordinate: \`${defaultCoords}\`).`,
      result,
      toolCallCount: 3,
      zeroNumeralCompliant: numeralCheck.valid,
      warnings: fetchRes.caveats,
    };
  }

  private isChartModificationOnly(query: string): boolean {
    const q = query.toLowerCase();
    return (
      q.includes('bar chart') ||
      q.includes('line chart') ||
      q.includes('scatter') ||
      q.includes('sort descending') ||
      q.includes('sort ascending')
    );
  }

  private extractChartIntentFromQuery(query: string, currentChart?: ChartIntent): ChartIntent {
    const q = query.toLowerCase();
    const updated: ChartIntent = currentChart ? { ...currentChart } : { purpose: 'trend', type: 'line' };

    if (q.includes('bar')) {
      updated.type = 'bar';
      updated.purpose = 'comparison';
    } else if (q.includes('line')) {
      updated.type = 'line';
      updated.purpose = 'trend';
    } else if (q.includes('scatter')) {
      updated.type = 'scatter';
      updated.purpose = 'relationship';
    }

    if (q.includes('descending')) {
      updated.sort = 'descending';
    } else if (q.includes('ascending')) {
      updated.sort = 'ascending';
    }

    return updated;
  }

  private async callLLM(messages: any[]): Promise<any> {
    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools: STATCAN_AGENT_TOOLS,
        tool_choice: 'auto',
      }),
    });

    if (!resp.ok) {
      throw new Error(`LLM API returned HTTP ${resp.status}`);
    }

    return resp.json();
  }

  private emit(event: AgentEvent) {
    if (this.onEvent) {
      this.onEvent(event);
    }
  }
}
