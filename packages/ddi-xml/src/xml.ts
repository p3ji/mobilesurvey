/**
 * Tiny, dependency-free XML reader/writer.
 *
 * This is intentionally small and isolated: the codec's mapping layer (`export.ts` / `import.ts`)
 * only ever sees the `XmlElement` tree produced/consumed here, so this module can later be swapped
 * for a hardened third-party parser (e.g. for the full DDI-Lifecycle 3.3 / Codebook 2.5 adapter)
 * without touching the mapping logic.
 *
 * Scope: well-formed XML using elements, attributes, character data, CDATA, comments, the XML
 * declaration and DOCTYPE/PI prologs. Namespaces are treated as opaque prefixes on the tag name
 * (`xml:lang` is read verbatim). Mixed content is flattened: an element's direct character data is
 * collected into `.text`, and its element children into `.children`. The serializer never emits an
 * element with both meaningful text and children, so the round-trip stays loss-free for our model.
 */

export class DdiXmlError extends Error {}

/** A parsed XML element. `text` holds this element's *direct* character data (not descendants'). */
export interface XmlElement {
  tag: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Concatenated direct character data, with entities decoded. Empty for structural elements. */
  text: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.charCodeAt(0) === 35 /* # */) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/** Parse an XML document and return its root element. Throws `DdiXmlError` on malformed input. */
export function parseXml(src: string): XmlElement {
  let pos = 0;
  const at = (p: number): string => src[p] ?? '';
  const isNameChar = (ch: string): boolean => ch !== '' && !/[\s/>=]/.test(ch);

  const fail = (msg: string): never => {
    throw new DdiXmlError(`${msg} (offset ${pos})`);
  };
  const skipSpace = (): void => {
    while (pos < src.length && /\s/.test(at(pos))) pos++;
  };
  const readName = (): string => {
    const start = pos;
    while (pos < src.length && isNameChar(at(pos))) pos++;
    if (pos === start) fail('expected a name');
    return src.slice(start, pos);
  };
  /** Skip whitespace, comments, processing instructions and `<!...>` declarations. */
  const skipProlog = (): void => {
    for (;;) {
      skipSpace();
      if (src.startsWith('<!--', pos)) {
        const end = src.indexOf('-->', pos);
        pos = end < 0 ? src.length : end + 3;
      } else if (src.startsWith('<?', pos)) {
        const end = src.indexOf('?>', pos);
        pos = end < 0 ? src.length : end + 2;
      } else if (src.startsWith('<!', pos)) {
        const end = src.indexOf('>', pos);
        pos = end < 0 ? src.length : end + 1;
      } else {
        return;
      }
    }
  };

  const parseElement = (): XmlElement => {
    if (at(pos) !== '<') fail('expected "<"');
    pos++; // consume '<'
    const tag = readName();
    const attrs: Record<string, string> = {};

    for (;;) {
      skipSpace();
      const ch = at(pos);
      if (ch === '/') {
        if (at(pos + 1) !== '>') fail('expected "/>"');
        pos += 2;
        return { tag, attrs, children: [], text: '' };
      }
      if (ch === '>') {
        pos++;
        break;
      }
      if (ch === '') fail(`unexpected end of input in start tag <${tag}>`);
      const name = readName();
      skipSpace();
      if (at(pos) !== '=') fail(`expected "=" after attribute "${name}"`);
      pos++;
      skipSpace();
      const quote = at(pos);
      if (quote !== '"' && quote !== "'") fail(`expected quote for attribute "${name}"`);
      pos++;
      const end = src.indexOf(quote, pos);
      if (end < 0) fail(`unterminated attribute "${name}"`);
      attrs[name] = decodeEntities(src.slice(pos, end));
      pos = end + 1;
    }

    // Content: children + direct text, until the matching close tag.
    const children: XmlElement[] = [];
    let text = '';
    for (;;) {
      if (pos >= src.length) fail(`unexpected end of input inside <${tag}>`);
      if (src.startsWith('</', pos)) {
        pos += 2;
        const closeName = readName();
        skipSpace();
        if (at(pos) !== '>') fail(`expected ">" in close tag </${closeName}>`);
        pos++;
        if (closeName !== tag) fail(`mismatched close tag </${closeName}> for <${tag}>`);
        return { tag, attrs, children, text };
      }
      if (src.startsWith('<!--', pos)) {
        const end = src.indexOf('-->', pos);
        pos = end < 0 ? src.length : end + 3;
        continue;
      }
      if (src.startsWith('<![CDATA[', pos)) {
        const end = src.indexOf(']]>', pos);
        text += end < 0 ? src.slice(pos + 9) : src.slice(pos + 9, end);
        pos = end < 0 ? src.length : end + 3;
        continue;
      }
      if (at(pos) === '<') {
        children.push(parseElement());
        continue;
      }
      const next = src.indexOf('<', pos);
      const chunk = next < 0 ? src.slice(pos) : src.slice(pos, next);
      text += decodeEntities(chunk);
      pos = next < 0 ? src.length : next;
    }
  };

  skipProlog();
  if (at(pos) !== '<') fail('no root element found');
  return parseElement();
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

function stringifyElement(el: XmlElement, indent: string): string {
  const attrs = Object.entries(el.attrs)
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('');
  if (el.children.length === 0) {
    if (el.text === '') return `${indent}<${el.tag}${attrs}/>`;
    return `${indent}<${el.tag}${attrs}>${escapeText(el.text)}</${el.tag}>`;
  }
  const inner = el.children.map((c) => stringifyElement(c, indent + '  ')).join('\n');
  return `${indent}<${el.tag}${attrs}>\n${inner}\n${indent}</${el.tag}>`;
}

/** Serialize a root element to a pretty-printed XML document with a UTF-8 declaration. */
export function serializeXml(root: XmlElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${stringifyElement(root, '')}\n`;
}
