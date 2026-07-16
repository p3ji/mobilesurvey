/**
 * Test-only XSD validation harness (docs/ddi-compliance-plan.md §3.4).
 *
 * Validates XML against the vendored official DDI-Lifecycle 3.3 schemas
 * (`packages/ddi-xml/schemas/3.3/XMLSchema/`, entry point `instance.xsd`) using
 * xmllint-wasm — real libxml2 compiled to WASM, so this is authoritative XSD 1.0
 * validation, not an approximation. Node-only (Vitest); the browser never validates.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateXML, memoryPages, type XMLValidationResult } from 'xmllint-wasm';

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas', '3.3', 'XMLSchema');

interface SchemaFile {
  fileName: string;
  contents: string;
}

let cache: { entry: SchemaFile; rest: SchemaFile[] } | null = null;

/**
 * Load instance.xsd (the entry point) + every other .xsd.
 *
 * xmllint-wasm's Emscripten FS writes preloaded files flat into `/` without creating
 * intermediate directories, so the bundle's `XHTML/xhtml-…` relative imports ENOENT. The
 * vendored files stay verbatim on disk; we flatten IN MEMORY only: XHTML files load under
 * their basenames, and the four schemas that reference `XHTML/…` get that prefix stripped
 * from their schemaLocation attributes. Verified no basename collisions between the two
 * directories, so the rewrite is unambiguous.
 */
function loadSchemas(): { entry: SchemaFile; rest: SchemaFile[] } {
  if (cache) return cache;
  const flatten = (contents: string): string => contents.replaceAll('schemaLocation="XHTML/', 'schemaLocation="');
  const top = readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('.xsd'))
    .map((f) => ({ fileName: f, contents: flatten(readFileSync(join(SCHEMA_DIR, f), 'utf8')) }));
  const xhtml = readdirSync(join(SCHEMA_DIR, 'XHTML'))
    .filter((f) => f.endsWith('.xsd') || f.endsWith('.ent')) // .ent: DTD character entities xhtml-charent-1.xsd loads
    .map((f) => ({ fileName: f, contents: flatten(readFileSync(join(SCHEMA_DIR, 'XHTML', f), 'utf8')) }));
  const all = [...top, ...xhtml];
  const entry = all.find((s) => s.fileName === 'instance.xsd');
  if (!entry) throw new Error('instance.xsd not found in vendored schema bundle');
  cache = { entry, rest: all.filter((s) => s !== entry) };
  return cache;
}

/** Validate a DDI XML document string against the official 3.3 schemas. */
export async function validateDdi(xml: string): Promise<XMLValidationResult> {
  const { entry, rest } = loadSchemas();
  return validateXML({
    xml: [{ fileName: 'document.xml', contents: xml }],
    schema: [entry],
    preload: rest,
    initialMemoryPages: 2 * memoryPages.MiB * 16, // 32 MiB
    maxMemoryPages: memoryPages.GiB / 4, // 256 MiB — schema set is large
  });
}

/** Formats validation errors into a readable, deduplicated punch-list for assertion output.
 * Parser/entity warnings don't affect `result.valid` (exit-code based), so they're filtered
 * out of the list to keep the punch-list actionable. */
export function formatErrors(result: XMLValidationResult, limit = 25): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const e of result.errors) {
    const key = e.message.trim();
    if (seen.has(key) || /warning\s*:/i.test(e.rawMessage)) continue;
    seen.add(key);
    lines.push(`  [line ${e.loc?.lineNumber ?? '?'}] ${key}`);
    if (lines.length >= limit) {
      lines.push(`  … (${result.errors.length} raw errors total)`);
      break;
    }
  }
  return lines.join('\n');
}
