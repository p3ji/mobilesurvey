/**
 * Distribution utilities: CSV parsing, token generation, mail-merge CSV export,
 * template variable interpolation, and email dispatch abstraction.
 */

import { personalizedRespondentLink, type AccessCodeRow } from './api.js';

export interface ParsedRecipient {
  email: string;
  name: string;
  customFields: Record<string, unknown>;
  code: string;
}

/**
 * Generate an unguessable, URL-safe random alphanumeric token.
 * Format: 8-char lowercase alphanumeric (e.g. "k8m2p4x9").
 */
export function generateToken(): string {
  const chars = '23456789abcdefghjkmnpqrstuvwxyz'; // unambiguous chars
  let token = '';
  for (let i = 0; i < 8; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/**
 * Robust CSV line splitter that respects quoted strings containing commas.
 */
export function splitCsvLine(line: string, delimiter = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parse recipient CSV or raw text lines into structured recipient objects.
 * Automatically identifies email, name, and arbitrary custom metadata columns.
 */
export function parseRecipientList(input: string): {
  recipients: ParsedRecipient[];
  detectedColumns: string[];
  errors: string[];
} {
  const errors: string[] = [];
  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { recipients: [], detectedColumns: [], errors: ['No data found in input'] };
  }

  // Detect delimiter: check first line for tabs, semicolons, or commas
  const firstLine = lines[0] ?? '';
  let delimiter = ',';
  if (firstLine.includes('\t')) delimiter = '\t';
  else if (firstLine.includes(';') && !firstLine.includes(',')) delimiter = ';';

  const firstTokens = splitCsvLine(firstLine, delimiter).map((t) => t.replace(/^["']|["']$/g, '').trim());

  // Check if first line is a header
  const emailHeaderIdx = firstTokens.findIndex((t) =>
    /^(?:email|e-mail|mail|courriel|user_email|recipient_email)$/i.test(t)
  );

  let hasHeader = emailHeaderIdx !== -1;
  let headers: string[] = [];
  let dataLines: string[] = [];

  if (hasHeader) {
    headers = firstTokens;
    dataLines = lines.slice(1);
  } else {
    // If first row looks like email address, assume no header
    const firstRowHasEmail = firstTokens.some((t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t));
    if (firstRowHasEmail) {
      hasHeader = false;
      headers = ['email'];
      dataLines = lines;
    } else {
      // Treat first row as potential headers if it has alphanumeric words
      headers = firstTokens;
      dataLines = lines.slice(1);
      hasHeader = true;
    }
  }

  // Normalize header names
  const emailIdx = headers.findIndex((h) => /^(?:email|e-mail|mail|courriel|user_email)$/i.test(h));
  const nameIdx = headers.findIndex((h) => /^(?:name|full_name|fullname|nom|respondent_name|first_name)$/i.test(h));

  const customColIndices: Array<{ index: number; name: string }> = [];
  headers.forEach((h, i) => {
    if (i !== emailIdx && i !== nameIdx && h) {
      customColIndices.push({ index: i, name: h });
    }
  });

  const recipients: ParsedRecipient[] = [];
  const seenEmails = new Set<string>();

  dataLines.forEach((line, lineIdx) => {
    const tokens = splitCsvLine(line, delimiter).map((t) => t.replace(/^["']|["']$/g, '').trim());
    if (tokens.length === 0 || tokens.every((t) => !t)) return;

    let email = '';
    let name = '';
    const customFields: Record<string, unknown> = {};

    if (emailIdx !== -1 && tokens[emailIdx]) {
      email = tokens[emailIdx]!.toLowerCase();
    } else {
      // Find first token that looks like an email
      const found = tokens.find((t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t));
      if (found) email = found.toLowerCase();
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`Row ${lineIdx + (hasHeader ? 2 : 1)}: Invalid or missing email address`);
      return;
    }

    if (seenEmails.has(email)) {
      // Skip duplicates or record warning
      return;
    }
    seenEmails.add(email);

    if (nameIdx !== -1 && tokens[nameIdx]) {
      name = tokens[nameIdx]!;
    }

    for (const col of customColIndices) {
      if (tokens[col.index] !== undefined && tokens[col.index] !== '') {
        customFields[col.name] = tokens[col.index]!;
      }
    }

    recipients.push({
      email,
      name,
      customFields,
      code: generateToken(),
    });
  });

  return {
    recipients,
    detectedColumns: customColIndices.map((c) => c.name),
    errors,
  };
}

/**
 * Interpolate template variables into subject or body string.
 * Supports {{variable_name}} with optional fallback or empty string.
 */
export function interpolateTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_, key) => {
    const val = vars[key];
    if (val !== undefined && val !== null) {
      return String(val);
    }
    return '';
  });
}

/**
 * Build a complete Mail-Merge CSV string with personalized single-click links.
 */
export function buildMailMergeCsv(surveyId: string, rows: AccessCodeRow[]): string {
  // Collect all unique custom field names across all rows
  const customKeySet = new Set<string>();
  for (const r of rows) {
    if (r.respondentFieldsJson) {
      for (const k of Object.keys(r.respondentFieldsJson)) {
        customKeySet.add(k);
      }
    }
  }
  const customKeys = [...customKeySet].sort();

  const headers = [
    'email',
    'name',
    'personalized_survey_link',
    'access_code',
    'status',
    'sent_at',
    'started_at',
    'completed_at',
    ...customKeys,
  ];

  const csvRows = rows.map((r) => {
    const link = personalizedRespondentLink(surveyId, r.code);
    const rowValues = [
      r.email ?? '',
      r.respondentName ?? '',
      link,
      r.code,
      r.status,
      r.sentAt ?? '',
      r.startedAt ?? '',
      r.completedAt ?? '',
      ...customKeys.map((k) => {
        const val = r.respondentFieldsJson?.[k];
        return val !== undefined && val !== null ? String(val) : '';
      }),
    ];
    return rowValues.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });

  return [headers.join(','), ...csvRows].join('\n');
}

// ── Email Dispatch Abstraction ────────────────────────────────────────────────

export type EmailProviderType = 'simulated' | 'resend' | 'sendgrid' | 'webhook';

export interface EmailProviderConfig {
  type: EmailProviderType;
  apiKey?: string;
  fromAddress?: string;
  fromName?: string;
  webhookUrl?: string;
}

export interface EmailMessagePayload {
  to: string;
  toName?: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
}

export const DEFAULT_EMAIL_SETTINGS_KEY = 'mobilesurvey:email_dispatch_settings';

export function loadEmailProviderConfig(): EmailProviderConfig {
  if (typeof window === 'undefined') return { type: 'simulated' };
  try {
    const raw = localStorage.getItem(DEFAULT_EMAIL_SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {
    type: 'simulated',
    fromAddress: 'surveys@msurvey.peji.ca',
    fromName: 'Survey Team',
  };
}

export function saveEmailProviderConfig(config: EmailProviderConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DEFAULT_EMAIL_SETTINGS_KEY, JSON.stringify(config));
  } catch {
    /* ignore */
  }
}

/**
 * Dispatch an individual email message via the configured provider.
 */
export async function sendEmailMessage(
  config: EmailProviderConfig,
  msg: EmailMessagePayload
): Promise<{ ok: boolean; error?: string }> {
  const from = config.fromAddress
    ? config.fromName
      ? `${config.fromName} <${config.fromAddress}>`
      : config.fromAddress
    : 'surveys@msurvey.peji.ca';

  if (config.type === 'simulated') {
    // Simulated demo mode
    await new Promise((r) => setTimeout(r, 60));
    // eslint-disable-next-line no-console
    console.info(`[Email Dispatch Simulated] To: ${msg.to} | Subject: "${msg.subject}"`);
    return { ok: true };
  }

  if (config.type === 'resend') {
    if (!config.apiKey) {
      return { ok: false, error: 'Resend API key is not configured.' };
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: msg.to,
          subject: msg.subject,
          text: msg.bodyText,
          html: msg.bodyHtml ?? msg.bodyText.replace(/\n/g, '<br/>'),
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        return { ok: false, error: (errJson as any)?.message || `Resend error: ${res.statusText}` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  if (config.type === 'sendgrid') {
    if (!config.apiKey) {
      return { ok: false, error: 'SendGrid API key is not configured.' };
    }
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: msg.to, name: msg.toName }] }],
          from: { email: config.fromAddress || 'surveys@msurvey.peji.ca', name: config.fromName || 'Survey Team' },
          subject: msg.subject,
          content: [{ type: 'text/plain', value: msg.bodyText }],
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({})) as { errors?: Array<{ message?: string }> };
        return { ok: false, error: errJson?.errors?.[0]?.message || `SendGrid error: ${res.statusText}` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  if (config.type === 'webhook') {
    if (!config.webhookUrl) {
      return { ok: false, error: 'Webhook URL is not configured.' };
    }
    try {
      const res = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: msg.to,
          toName: msg.toName,
          from,
          subject: msg.subject,
          text: msg.bodyText,
        }),
      });
      if (!res.ok) {
        return { ok: false, error: `Webhook responded with status ${res.status}` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  return { ok: false, error: `Unsupported email provider: ${config.type}` };
}
