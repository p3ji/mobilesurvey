/**
 * Anthropic-vision RecognitionProvider — the sensor module's demo default
 * (docs/sensor-module-plan.md D5).
 *
 * SECURITY WARNING: this calls the Anthropic API directly from the browser using a
 * client-bundled API key (`VITE_ANTHROPIC_API_KEY`). Unlike the Supabase anon key — a
 * publishable key designed to be public — a real Anthropic API key is a genuine secret;
 * bundling it client-side means anyone can extract and use it under your account. Acceptable
 * ONLY for a personal/low-stakes demo. The production path is the same `RecognitionProvider`
 * interface fronted by a serverless proxy (Supabase Edge Function / Cloudflare Worker) that
 * holds the key server-side; it is documented but not built — same posture as the hub's
 * `validatorLlm.ts`.
 *
 * The feature is hidden entirely when no key is configured: `recognizePhoto` reports
 * `unavailable` and the item list falls back to manual entry (graceful absence).
 */
import type {
  RecognitionItem,
  RecognitionProfile,
  RecognitionProvider,
  RecognitionResult,
} from '@mobilesurvey/runtime-engine';

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;
const MODEL = 'claude-sonnet-5';

export function recognitionConfigured(): boolean {
  return Boolean(ANTHROPIC_KEY);
}

const PROFILE_PROMPT: Record<RecognitionProfile, string> = {
  food: 'Identify each distinct food or drink item visible in this photo and estimate the quantity of each (grams for solids, millilitres for liquids, or count of servings when weight is not estimable).',
  document: 'Identify each distinct document or document element visible in this photo (e.g. receipt, form, label). Quantity is the count of each.',
  generic: 'Identify each distinct object visible in this photo. Quantity is the count of each.',
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Tolerant JSON extraction: the model is asked for bare JSON but may wrap it in prose. */
function parseItems(raw: string, maxItems: number): RecognitionItem[] {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  const parsed = JSON.parse(match[0]) as { items?: unknown };
  if (!Array.isArray(parsed.items)) return [];
  const items: RecognitionItem[] = [];
  for (const it of parsed.items.slice(0, maxItems)) {
    const o = it as { label?: unknown; qty?: unknown; unit?: unknown; confidence?: unknown };
    if (typeof o.label !== 'string' || o.label.trim() === '') continue;
    const unit = o.unit === 'g' || o.unit === 'ml' || o.unit === 'serving' ? o.unit : undefined;
    const qty = typeof o.qty === 'number' && Number.isFinite(o.qty) && o.qty >= 0 ? o.qty : undefined;
    const conf = typeof o.confidence === 'number' ? Math.min(Math.max(o.confidence, 0), 1) : 0.5;
    items.push({ label: o.label.trim(), qty, unit, confidence: conf });
  }
  return items;
}

export function createAnthropicRecognitionProvider(): RecognitionProvider | null {
  if (!ANTHROPIC_KEY) return null;
  return {
    recognize: async (blob, profile, opts): Promise<RecognitionResult> => {
      const t0 = performance.now();
      const b64 = await blobToBase64(blob);
      const prompt =
        `${PROFILE_PROMPT[profile]}\n\n` +
        `Respond with ONLY a JSON object, no prose:\n` +
        `{"items": [{"label": "<short name>", "qty": <number, optional>, "unit": "g"|"ml"|"serving", "confidence": <0..1>}]}\n` +
        `At most ${opts.maxItems} items. Omit anything you cannot identify with confidence above 0.2. ` +
        `These are suggestions a survey respondent will review and correct — be conservative.`;
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          // Required by the API to allow a direct browser call at all — itself a signal that
          // this is not the intended deployment shape; see the module-level warning above.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
                { type: 'text', text: prompt },
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`recognition request failed: ${res.status}`);
      const data: unknown = await res.json();
      const text = (data as { content?: { text?: string }[] })?.content?.[0]?.text ?? '';
      return {
        items: parseItems(text, opts.maxItems),
        modelId: MODEL,
        latencyMs: Math.round(performance.now() - t0),
      };
    },
  };
}
