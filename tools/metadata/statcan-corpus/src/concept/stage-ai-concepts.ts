import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Environment discovery
const candidatePaths = [
  resolve(import.meta.dirname, '../../.env'),
  resolve(import.meta.dirname, '../../.env.local'),
  resolve(import.meta.dirname, '../../../../../platform/hub/.env.local'),
  resolve(import.meta.dirname, '../../../../../platform/hub/.env'),
];

for (const envPath of candidatePaths) {
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) {
          const key = trimmed.slice(0, eq).trim();
          const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
          if (key && val && !process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    } catch {}
  }
}

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)?.replace(/\/+$/, '');
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Error: Supabase credentials not found in environment.');
  process.exit(1);
}

export interface CandidateVariable {
  record_id: string;
  name: string;
  survey_acronym: string;
  year: number;
  question_text: string;
}

export interface SynthesizedConcept {
  record_id: string;
  name: string;
  survey_acronym: string;
  year: number;
  question_text: string;
  concept: string;
  provenance: 'ai_inferred';
}

/**
 * Standardizes a question text into a clean 3-7 word concept label.
 * Drops conversational interviewing boilerplate while retaining:
 * - The topical construct (e.g. "Cyber risk insurance", "Ransom payments", "Food security")
 * - Specific category/sub-item selections (e.g. "Do not know", "Cryptocurrency", "Outside of work")
 * - Important temporal or scope qualifiers
 */
export function synthesizeConceptLabel(questionText: string): string {
  let text = questionText.trim();

  // 1. Clean de-hyphenation from PDF breaks (e.g. "inci-dents" -> "incidents")
  text = text.replace(/([A-Za-z])-([A-Za-z])/g, '$1$2');

  // 2. Separate question stem and sub-item if multi-part battery
  let stem = text;
  let subItem = '';

  const qMarkIdx = text.indexOf('?');
  if (qMarkIdx !== -1 && qMarkIdx < text.length - 2) {
    stem = text.slice(0, qMarkIdx).trim();
    subItem = text.slice(qMarkIdx + 1).trim();
  }

  // 3. Remove interview prompt boilerplate from the stem
  let cleanStem = stem
    .replace(/^In\s+(?:the\s+past\s+\d+\s+months|20\d\d|\d{4}),\s*/i, '')
    .replace(/^During\s+the\s+(?:past|last)\s+\d+\s+months,\s*/i, '')
    .replace(/^(?:Which of the following|Please select all that apply|Please indicate whether|Did your business|Does your business|Has your business|Have you|Did you|Do you|Would you say)\s+/i, '')
    .replace(/^(?:Why does your business not have|Why did your business not|What was the|What were the|Which external parties did your business)\s+/i, '')
    .replace(/^(?:How important is it|How often did you|How many)\s+/i, '')
    .trim();

  // Capitalize first letter
  if (cleanStem.length > 0) {
    cleanStem = cleanStem.charAt(0).toUpperCase() + cleanStem.slice(1);
  }

  // Clean trailing punctuation
  cleanStem = cleanStem.replace(/[?:.—,-]+$/, '').trim();
  subItem = subItem.replace(/^[?:.—,-]+|[?:.—,-]+$/g, '').trim();

  // Combine into standard StatCan concept shape: "Construct - Specifics"
  if (subItem && cleanStem) {
    return `${cleanStem} - ${subItem}`;
  }
  return cleanStem || text.slice(0, 80);
}

async function main() {
  console.log('Fetching candidate variables with null concept...');
  const res = await fetch(
    `${supabaseUrl}/rest/v1/corpus_variable?select=record_id,name,survey_acronym,year,question_text&or=(concept.is.null,concept.eq.)&question_text=not.is.null&lang=eq.en&limit=100`,
    {
      headers: {
        apikey: supabaseAnonKey!,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
    }
  );

  if (!res.ok) {
    console.error('Failed to fetch variables:', await res.text());
    process.exit(1);
  }

  const variables = (await res.json()) as CandidateVariable[];
  console.log(`Fetched ${variables.length} candidates. Synthesizing concepts...`);

  const results: SynthesizedConcept[] = [];
  for (const v of variables) {
    if (!v.question_text || v.question_text.trim() === '') continue;
    const concept = synthesizeConceptLabel(v.question_text);
    results.push({
      ...v,
      concept,
      provenance: 'ai_inferred',
    });
  }

  // Generate review artifact
  const outJsonPath = resolve(import.meta.dirname, '../../out/staged_ai_concepts.json');
  writeFileSync(outJsonPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Wrote ${results.length} staged concepts to ${outJsonPath}`);

  // Generate idempotent SQL patch
  const outSqlPath = resolve(import.meta.dirname, '../../out/staged_ai_concepts.sql');
  const sqlLines: string[] = [
    '-- Idempotent staging patch: AI-inferred concepts for variables missing concept',
    '-- Safe: Only updates rows where concept IS NULL or empty',
    'BEGIN;',
  ];

  for (const r of results) {
    const escapedConcept = r.concept.replace(/'/g, "''");
    sqlLines.push(
      `UPDATE corpus_variable SET concept = '${escapedConcept}' WHERE record_id = '${r.record_id}' AND (concept IS NULL OR trim(concept) = '');`
    );
  }

  sqlLines.push('COMMIT;');
  writeFileSync(outSqlPath, sqlLines.join('\n'), 'utf8');
  console.log(`Wrote idempotent SQL update script to ${outSqlPath}`);
}

if (process.argv[1] === import.meta.filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
