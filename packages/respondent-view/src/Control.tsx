/**
 * Renders the input control for a single response-domain type. Excludes `markAll`, which answers
 * into several independent dichotomous variables and is rendered inline by `QuestionPage` instead.
 */
import type { CategoryScheme, Instrument, ResponseDomain } from '@mobilesurvey/instrument-schema';

function schemeCategories(schemes: CategoryScheme[], ref: string) {
  return schemes.find((s) => s.id === ref)?.categories ?? [];
}

function lbl(intl: Record<string, string> | undefined, lang: string): string {
  if (!intl) return '';
  return intl[lang] ?? Object.values(intl)[0] ?? '';
}

export function Control({
  domain,
  inputId,
  value,
  instrument,
  lang,
  required,
  hasError,
  errorId,
  onChange,
}: {
  domain: Exclude<ResponseDomain, { type: 'markAll' }>;
  inputId: string;
  value: unknown;
  instrument: Instrument;
  lang: string;
  required?: boolean;
  hasError?: boolean;
  errorId?: string;
  onChange: (v: unknown) => void;
}) {
  const ariaProps = {
    'aria-required': required || undefined,
    'aria-invalid': hasError || undefined,
    'aria-describedby': hasError && errorId ? errorId : undefined,
  };

  switch (domain.type) {
    case 'numeric':
      return (
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          value={value === undefined || value === null ? '' : String(value)}
          min={domain.min}
          max={domain.max}
          {...ariaProps}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'text':
      return domain.multiline ? (
        <textarea
          id={inputId}
          rows={3}
          value={(value as string) ?? ''}
          {...ariaProps}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={inputId}
          type="text"
          maxLength={domain.maxLength}
          value={(value as string) ?? ''}
          {...ariaProps}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'boolean':
      return (
        <div
          className="eq__radios"
          role="radiogroup"
          aria-labelledby={inputId}
          aria-required={required || undefined}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError && errorId ? errorId : undefined}
        >
          {[
            { v: true, l: lang === 'fr' ? 'Oui' : 'Yes' },
            { v: false, l: lang === 'fr' ? 'Non' : 'No' },
          ].map((opt) => (
            <label key={String(opt.v)} className="eq__radio">
              <input
                type="radio"
                name={inputId}
                checked={value === opt.v}
                onChange={() => onChange(opt.v)}
              />
              {opt.l}
            </label>
          ))}
        </div>
      );
    case 'datetime':
      return (
        <input
          id={inputId}
          type={domain.mode === 'datetime' ? 'datetime-local' : domain.mode}
          value={(value as string) ?? ''}
          {...ariaProps}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'file':
      return (
        <input
          id={inputId}
          type="file"
          accept={domain.accept?.join(',')}
          {...ariaProps}
          onChange={() => onChange('(file selected)')}
        />
      );
    case 'lookup': {
      const opts = schemeCategories(instrument.categorySchemes, domain.categorySchemeRef);
      const listId = `${inputId}-list`;
      return (
        <>
          <input
            id={inputId}
            list={listId}
            value={(value as string) ?? ''}
            placeholder={lang === 'fr' ? 'Rechercher…' : 'Search…'}
            {...ariaProps}
            onChange={(e) => onChange(e.target.value)}
          />
          <datalist id={listId}>
            {opts.map((c) => (
              <option key={c.code} value={lbl(c.label, lang)} />
            ))}
          </datalist>
        </>
      );
    }
    case 'code': {
      const opts = schemeCategories(instrument.categorySchemes, domain.categorySchemeRef);
      if (domain.selection === 'multiple') {
        const arr = Array.isArray(value) ? (value as string[]) : [];
        return (
          <div
            className="eq__radios"
            role="group"
            aria-labelledby={inputId}
            aria-required={required || undefined}
            aria-invalid={hasError || undefined}
            aria-describedby={hasError && errorId ? errorId : undefined}
          >
            {opts.map((c) => (
              <label key={c.code} className="eq__radio">
                <input
                  type="checkbox"
                  checked={arr.includes(c.code)}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...arr, c.code] : arr.filter((x) => x !== c.code))
                  }
                />
                {lbl(c.label, lang)}
              </label>
            ))}
          </div>
        );
      }
      return (
        <div
          className="eq__radios"
          role="radiogroup"
          aria-labelledby={inputId}
          aria-required={required || undefined}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError && errorId ? errorId : undefined}
        >
          {opts.map((c) => (
            <label key={c.code} className="eq__radio">
              <input
                type="radio"
                name={inputId}
                checked={value === c.code}
                onChange={() => onChange(c.code)}
              />
              {lbl(c.label, lang)}
            </label>
          ))}
        </div>
      );
    }
  }
}
