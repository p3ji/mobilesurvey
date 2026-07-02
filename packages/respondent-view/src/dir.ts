/** BCP-47 language codes that read right-to-left. */
const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur']);

/** True if the given language code should render right-to-left. */
export function isRtl(lang: string): boolean {
  return RTL_LANGS.has(lang);
}
