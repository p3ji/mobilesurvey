/** Reusable, accessible form fields used throughout the inspector. */
import { useId, type ReactNode } from 'react';
import { compile, variablesUsed } from '@mobilesurvey/expression-engine';
import type { InternationalString, LanguageCode } from '@mobilesurvey/instrument-schema';

/** Label + control wrapper with an explicit `htmlFor` association. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {hint ? <p className="field__hint">{hint}</p> : null}
      {children(id)}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

/** Edits every language of an InternationalString, one input per declared language. */
export function IntlStringField({
  label,
  value,
  languages,
  onChange,
  multiline,
}: {
  label: string;
  value: InternationalString | undefined;
  languages: LanguageCode[];
  onChange: (next: InternationalString) => void;
  multiline?: boolean;
}) {
  const current = value ?? {};
  const set = (lang: LanguageCode, text: string) => onChange({ ...current, [lang]: text });
  return (
    <fieldset className="field intl">
      <legend className="field__label">{label}</legend>
      {languages.map((lang) => {
        const inputId = `intl-${label}-${lang}`.replace(/\s+/g, '-');
        return (
          <div className="intl__row" key={lang}>
            <label className="intl__lang" htmlFor={inputId}>
              {lang.toUpperCase()}
            </label>
            {multiline ? (
              <textarea
                id={inputId}
                rows={2}
                value={current[lang] ?? ''}
                onChange={(e) => set(lang, e.target.value)}
              />
            ) : (
              <input
                id={inputId}
                type="text"
                value={current[lang] ?? ''}
                onChange={(e) => set(lang, e.target.value)}
              />
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

/**
 * Expression input with live parse feedback. Shows the parse error (if any) and the variables the
 * expression references — backed by `@mobilesurvey/expression-engine`.
 */
export function ConditionField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const trimmed = (value ?? '').trim();
  const result = trimmed === '' ? { ok: true as const } : compile(trimmed);
  const used = trimmed === '' ? [] : variablesUsed(trimmed);
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <>
          <textarea
            id={id}
            className={result.ok ? 'expr' : 'expr expr--error'}
            rows={2}
            spellCheck={false}
            value={value}
            placeholder="e.g. $age >= 18 && $country == 'CA'"
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={!result.ok}
          />
          {!result.ok ? (
            <p className="expr__error" role="alert">
              {result.error}
            </p>
          ) : used.length > 0 ? (
            <p className="expr__vars">references: {used.map((v) => `$${v}`).join(', ')}</p>
          ) : null}
        </>
      )}
    </Field>
  );
}
