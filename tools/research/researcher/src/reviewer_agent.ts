import { SourceWork, Extraction } from './model.js';

export interface AuditEvaluation {
  approved: boolean;
  issues: string[];
  roleRecommendation?: 'analyzed' | 'comparison' | 'background_mention';
  cycleRecommendation?: string[];
  critique: string;
}

const REVIEWER_SYSTEM_PROMPT = `You are an Adversarial Audit Critic evaluating research publication claims about Statistics Canada surveys.
Your goal is to vigorously challenge optimistic or hallucinated claims made by extraction workers.

Audit Rules:
1. PASSING CITATION TRAP:
   - If the passage merely cites survey statistics for background motivation (e.g., "According to Statistics Canada (2015)...", "the CCHS indicated that 83%..."), it is STRICTLY 'background_mention', NOT 'analyzed'.
   - Role 'analyzed' REQUIRES direct primary empirical microdata modeling by the authors (e.g. regression models, sample sizes drawn, logistic estimation, "we analyze microdata").
2. PHANTOM CYCLES:
   - Verify that claimed cycles are real historical collection years, not bibliographic citation dates (e.g. "Statistics Canada (2013)" is a citation year, not a CCHS cycle year).
   - If the passage mentions no specific survey wave, exactCycles must be empty and precision must be 'program_only'.
3. VERBATIM SUBSTRING CHECK:
   - Every single quote MUST be an exact verbatim substring of the passage. Zero paraphrasing.

Return valid JSON with:
{
  "approved": boolean,
  "roleRecommendation": "analyzed" | "comparison" | "background_mention",
  "issues": string[],
  "critique": string
}`;

export async function auditExtractionWithLocalLLM(
  source: SourceWork,
  passage: string,
  extraction: Extraction,
  endpoint: string = 'http://127.0.0.1:1234/v1',
  model: string = 'microsoft/phi-4'
): Promise<AuditEvaluation> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1500,
        messages: [
          { role: 'system', content: REVIEWER_SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              title: source.title,
              passage: passage.slice(0, 3000),
              proposedExtraction: extraction,
            }),
          },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      return {
        approved: false,
        issues: [`Auditor HTTP ${response.status}: ${await response.text()}`],
        critique: 'Auditor request failed',
      };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return {
        approved: false,
        issues: ['Auditor returned empty response'],
        critique: 'Empty critique',
      };
    }

    const parsed = JSON.parse(content) as {
      approved?: boolean;
      roleRecommendation?: 'analyzed' | 'comparison' | 'background_mention';
      issues?: string[];
      critique?: string;
    };

    return {
      approved: Boolean(parsed.approved),
      roleRecommendation: parsed.roleRecommendation,
      issues: parsed.issues || [],
      critique: parsed.critique || '',
    };
  } catch (err: any) {
    return {
      approved: false,
      issues: [`Auditor error: ${err.message || err}`],
      critique: 'Execution exception',
    };
  } finally {
    clearTimeout(timeout);
  }
}
