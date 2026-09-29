/**
 * Text piping: replace `${...}` tokens in question/statement text. A bare identifier token
 * (`${memberName}`, `${m}`) resolves as a variable/loop index; anything else is evaluated as a
 * full expression (`${upper($region)}`). Unresolved tokens render as empty strings.
 */
import { evaluate, parse, type EvalContext } from '@mobilesurvey/expression-engine';
import type { InternationalString, LanguageCode } from '@mobilesurvey/instrument-schema';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function resolvePiping(text: string, context: EvalContext): string {
  return text.replace(/\$\{([^}]+)\}/g, (_match, raw: string) => {
    const token = raw.trim();
    try {
      const value = IDENT.test(token)
        ? context.resolve(token)
        : evaluate(parse(token), context);
      return value === null || value === undefined ? '' : String(value);
    } catch {
      return '';
    }
  });
}

/** Pick a language from an InternationalString, falling back to any available language. */
export function pick(text: InternationalString | undefined, language: LanguageCode): string {
  if (!text) return '';
  if (text[language] !== undefined) return text[language]!;
  const first = Object.values(text)[0];
  return first ?? '';
}

/** Localize then pipe an InternationalString. */
export function localizePiped(
  text: InternationalString | undefined,
  language: LanguageCode,
  context: EvalContext,
): string {
  return resolvePiping(pick(text, language), context);
}
