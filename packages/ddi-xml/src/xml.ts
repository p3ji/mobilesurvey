/** Minimal XML builder (template strings, no deps) and recursive-descent tokenizer. */

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function el(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: string[]
): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join('');
  const body = children.filter(Boolean).join('');
  return body ? `<${tag}${a}>${body}</${tag}>` : `<${tag}${a}/>`;
}

/** Build a leaf element whose text content is escaped. */
export function txt(tag: string, attrs: Record<string, string>, value: string): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join('');
  return `<${tag}${a}>${esc(value)}</${tag}>`;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

export interface XmlNode {
  tag: string;
  localName: string;
  prefix: string;
  /** Attribute values with entity references resolved. */
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Concatenated, trimmed text content (entities resolved). */
  text: string;
}

class Tokenizer {
  private s: string;
  private i = 0;

  constructor(s: string) { this.s = s; }

  parse(): XmlNode {
    this.skipProlog();
    return this.parseElement();
  }

  private at(n = 1): string { return this.s.slice(this.i, this.i + n); }

  private skipWs(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++;
  }

  private skipProlog(): void {
    this.skipWs();
    while (this.at(2) === '<?' || this.at(4) === '<!--' || this.at(9) === '<!DOCTYPE') {
      if (this.at(4) === '<!--') {
        const end = this.s.indexOf('-->', this.i);
        this.i = end < 0 ? this.s.length : end + 3;
      } else if (this.at(9) === '<!DOCTYPE') {
        let depth = 0;
        while (this.i < this.s.length) {
          const ch = this.s[this.i++];
          if (ch === '[') depth++;
          else if (ch === ']') depth--;
          else if (ch === '>' && depth === 0) break;
        }
      } else {
        const end = this.s.indexOf('?>', this.i);
        this.i = end < 0 ? this.s.length : end + 2;
      }
      this.skipWs();
    }
  }

  private parseElement(): XmlNode {
    if (this.s[this.i] !== '<') throw new Error(`Expected '<' at pos ${this.i}`);
    this.i++;
    const tagStart = this.i;
    while (this.i < this.s.length && !/[\s/>]/.test(this.s[this.i]!)) this.i++;
    const tag = this.s.slice(tagStart, this.i);
    const colon = tag.indexOf(':');
    const prefix = colon >= 0 ? tag.slice(0, colon) : '';
    const localName = colon >= 0 ? tag.slice(colon + 1) : tag;

    const attrs: Record<string, string> = {};
    this.skipWs();
    while (this.i < this.s.length && this.s[this.i] !== '/' && this.s[this.i] !== '>') {
      const nameStart = this.i;
      while (this.i < this.s.length && !/[\s=/>]/.test(this.s[this.i]!)) this.i++;
      const name = this.s.slice(nameStart, this.i);
      this.skipWs();
      if (this.s[this.i] !== '=') throw new Error(`Expected '=' at pos ${this.i}`);
      this.i++;
      this.skipWs();
      const q = this.s[this.i];
      if (q !== '"' && q !== "'") throw new Error(`Expected quote at pos ${this.i}`);
      this.i++;
      const valStart = this.i;
      while (this.i < this.s.length && this.s[this.i] !== q) this.i++;
      attrs[name] = this.unescape(this.s.slice(valStart, this.i));
      this.i++;
      this.skipWs();
    }

    const children: XmlNode[] = [];
    let rawText = '';

    if (this.s[this.i] === '/') {
      this.i += 2; // '/>'
    } else {
      this.i++; // '>'
      while (this.i < this.s.length) {
        if (this.at(4) === '<!--') {
          const end = this.s.indexOf('-->', this.i);
          this.i = end < 0 ? this.s.length : end + 3;
        } else if (this.at(9) === '<![CDATA[') {
          const end = this.s.indexOf(']]>', this.i + 9);
          rawText += end < 0 ? this.s.slice(this.i + 9) : this.s.slice(this.i + 9, end);
          this.i = end < 0 ? this.s.length : end + 3;
        } else if (this.at(2) === '</') {
          this.i += 2;
          while (this.i < this.s.length && this.s[this.i] !== '>') this.i++;
          this.i++;
          break;
        } else if (this.s[this.i] === '<') {
          children.push(this.parseElement());
        } else {
          const textStart = this.i;
          while (this.i < this.s.length && this.s[this.i] !== '<') this.i++;
          rawText += this.s.slice(textStart, this.i);
        }
      }
    }

    return {
      tag, prefix, localName, attrs, children,
      text: this.unescape(rawText).trim(),
    };
  }

  private unescape(s: string): string {
    return s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
  }
}

export function parseXml(xml: string): XmlNode {
  return new Tokenizer(xml).parse();
}
