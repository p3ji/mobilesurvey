/**
 * Entry Module Builder — wizard that scaffolds a pre-interview validation sequence.
 *
 * Generates:
 *   Step 1 — Phone validation (confirm number, optional alternate)
 *   Step 2 — Address validation (street, city, province, postal code)
 *   Step 3 — Configuration (block main until complete, show in self-admin)
 *
 * The generated Sequence is prepended to the root sequence with moduleKind='entry',
 * interviewerOnly=true (unless the user disables that in Step 3).
 */
import { useState } from 'react';
import type { SequenceConstruct, Variable } from '@mobilesurvey/instrument-schema';
import { useDesigner } from '../store/instrumentStore.js';
import { genId } from '../lib/tree.js';

interface Props {
  onDone: () => void;
}

interface EntryConfig {
  includeAltPhone: boolean;
  includeAddress: boolean;
  includeProvince: boolean;
  blockMainUntilComplete: boolean;
  showInSelfAdmin: boolean;
}

const DEFAULT_CONFIG: EntryConfig = {
  includeAltPhone: true,
  includeAddress: true,
  includeProvince: true,
  blockMainUntilComplete: true,
  showInSelfAdmin: false,
};

const PROVINCE_CODES = [
  { code: 'AB', label: 'Alberta' },
  { code: 'BC', label: 'British Columbia' },
  { code: 'MB', label: 'Manitoba' },
  { code: 'NB', label: 'New Brunswick' },
  { code: 'NL', label: 'Newfoundland and Labrador' },
  { code: 'NS', label: 'Nova Scotia' },
  { code: 'NT', label: 'Northwest Territories' },
  { code: 'NU', label: 'Nunavut' },
  { code: 'ON', label: 'Ontario' },
  { code: 'PE', label: 'Prince Edward Island' },
  { code: 'QC', label: 'Quebec' },
  { code: 'SK', label: 'Saskatchewan' },
  { code: 'YT', label: 'Yukon' },
];

export function EntryModuleBuilder({ onDone }: Props) {
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState<EntryConfig>(DEFAULT_CONFIG);
  const [building, setBuilding] = useState(false);
  const update = useDesigner((s) => s.update);

  const toggle = (key: keyof EntryConfig) =>
    setConfig((c) => ({ ...c, [key]: !c[key] }));

  const build = () => {
    setBuilding(true);
    update((draft) => {
      const langs = draft.languages;
      const il = (en: string, fr?: string): Record<string, string> =>
        Object.fromEntries(langs.map((l) => [l, l === 'fr' && fr ? fr : en]));

      const newVars: Variable[] = [];
      const addVar = (
        name: string,
        labelEn: string,
        labelFr: string,
        rep: Variable['representation'],
        categorySchemeRef?: string,
      ): Variable => {
        const existing = draft.variables.find((v) => v.name === name);
        if (existing) return existing;
        const v: Variable = {
          id: genId('v'),
          name,
          kind: 'collected',
          label: il(labelEn, labelFr),
          representation: rep,
          interviewerOnly: !config.showInSelfAdmin,
          ...(categorySchemeRef ? { categorySchemeRef } : {}),
        };
        newVars.push(v);
        return v;
      };

      // ── Province category scheme ──────────────────────────────────────────
      let provinceSchemeId = 'cs_province_pt';
      if (config.includeProvince) {
        const existing = draft.categorySchemes.find((s) => s.id === provinceSchemeId);
        if (!existing) {
          draft.categorySchemes.push({
            id: provinceSchemeId,
            label: il('Canadian Provinces & Territories', 'Provinces et territoires du Canada'),
            categories: PROVINCE_CODES.map(({ code, label }) => ({
              code,
              label: il(label),
            })),
          });
        }
      }

      // ── Questions ─────────────────────────────────────────────────────────
      const questions: SequenceConstruct['children'] = [];

      // Phone confirm
      addVar('entry_phone_confirm', 'Confirm respondent phone number', 'Confirmer le numéro de téléphone', 'text');
      questions.push({
        type: 'question',
        id: genId('q'),
        variableRef: 'entry_phone_confirm',
        text: il(
          'Please confirm the telephone number we called: is this [PHONE]?',
          'Veuillez confirmer le numéro de téléphone que nous avons composé : est-ce [PHONE] ?',
        ),
        instruction: il(
          'Confirm the number matches the sample frame record. If not, update and note the correct number.',
          "Confirmez que le numéro correspond au dossier du cadre d'échantillonnage. Sinon, notez le numéro correct.",
        ),
        responseDomain: { type: 'boolean' },
        interviewerOnly: !config.showInSelfAdmin,
      });

      if (config.includeAltPhone) {
        addVar('entry_phone_alt', 'Alternate contact number', 'Numéro de contact alternatif', 'text');
        questions.push({
          type: 'question',
          id: genId('q'),
          variableRef: 'entry_phone_alt',
          text: il(
            'Is there another telephone number where someone in this household can be reached?',
            'Y a-t-il un autre numéro de téléphone où une personne de ce ménage peut être jointe ?',
          ),
          responseDomain: { type: 'text', pattern: '^[0-9\\-\\+\\s\\(\\)]{7,15}$' },
          interviewerOnly: !config.showInSelfAdmin,
          ...(config.blockMainUntilComplete ? {} : {}),
        });
      }

      if (config.includeAddress) {
        addVar('entry_address_street', 'Street address', 'Adresse civique', 'text');
        questions.push({
          type: 'question',
          id: genId('q'),
          variableRef: 'entry_address_street',
          text: il(
            "What is the street address of the respondent's dwelling?",
            "Quelle est l'adresse civique du logement du répondant ?",
          ),
          responseDomain: { type: 'text' },
          interviewerOnly: !config.showInSelfAdmin,
        });

        addVar('entry_address_city', 'City / Municipality', 'Ville / Municipalité', 'text');
        questions.push({
          type: 'question',
          id: genId('q'),
          variableRef: 'entry_address_city',
          text: il('City or municipality', 'Ville ou municipalité'),
          responseDomain: { type: 'text' },
          interviewerOnly: !config.showInSelfAdmin,
        });

        if (config.includeProvince) {
          addVar('entry_address_province', 'Province / Territory', 'Province / Territoire', 'code', provinceSchemeId);
          questions.push({
            type: 'question',
            id: genId('q'),
            variableRef: 'entry_address_province',
            text: il('Province or territory', 'Province ou territoire'),
            responseDomain: { type: 'code', categorySchemeRef: provinceSchemeId, selection: 'single' },
            interviewerOnly: !config.showInSelfAdmin,
          });
        }

        addVar('entry_address_postal', 'Postal code', 'Code postal', 'text');
        questions.push({
          type: 'question',
          id: genId('q'),
          variableRef: 'entry_address_postal',
          text: il('Postal code', 'Code postal'),
          responseDomain: { type: 'text', pattern: '^[A-Za-z]\\d[A-Za-z][ -]?\\d[A-Za-z]\\d$' },
          interviewerOnly: !config.showInSelfAdmin,
        });
      }

      // ── Assemble the entry sequence ───────────────────────────────────────
      const seqId = genId('entry');
      const entrySeq: SequenceConstruct = {
        type: 'sequence',
        id: seqId,
        label: il('Entry — Respondent Validation', 'Entrée — Validation du répondant'),
        moduleKind: 'entry',
        interviewerOnly: !config.showInSelfAdmin,
        children: questions,
      };

      // Prepend variables
      draft.variables.push(...newVars);

      // Prepend entry sequence to root
      draft.sequence.children.unshift(entrySeq);

      // Update interviewer config refs
      if (!draft.interviewer) {
        draft.interviewer = { enabled: true, allowFreeNavigation: true };
      }
      draft.interviewer.entryModuleRef = seqId;
    });

    setBuilding(false);
    onDone();
  };

  return (
    <div className="inspector iv-builder">
      <div className="iv-builder__header">
        <h3>Entry Module Builder</h3>
        <div className="iv-builder__steps">
          {[1, 2, 3].map((s) => (
            <button
              key={s}
              type="button"
              className={`iv-builder__step${step === s ? ' iv-builder__step--active' : step > s ? ' iv-builder__step--done' : ''}`}
              onClick={() => setStep(s)}
            >
              {step > s ? '✓' : s}
            </button>
          ))}
        </div>
      </div>

      {step === 1 && (
        <div className="iv-builder__body">
          <h4>Step 1 — Phone Validation</h4>
          <p className="hint">
            These questions are asked before the main survey to confirm the respondent's
            identity and phone number against the sample frame.
          </p>
          <div className="iv-builder__preview">
            <div className="iv-builder__q">
              <span className="iv-builder__q-label">Q1</span>
              <span>Confirm telephone number we called — <em>boolean (yes/no)</em></span>
              <span className="iv-builder__q-iv">🎧 Interviewer only</span>
            </div>
            <label className="checkbox" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={config.includeAltPhone}
                onChange={() => toggle('includeAltPhone')}
              />
              Include alternate phone number question
            </label>
            {config.includeAltPhone && (
              <div className="iv-builder__q iv-builder__q--optional">
                <span className="iv-builder__q-label">Q2</span>
                <span>Other phone number for this household — <em>text</em></span>
                <span className="iv-builder__q-iv">🎧 Interviewer only</span>
              </div>
            )}
          </div>
          <div className="iv-builder__nav">
            <button type="button" onClick={onDone}>Cancel</button>
            <button type="button" className="btn btn--primary" onClick={() => setStep(2)}>Next →</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="iv-builder__body">
          <h4>Step 2 — Address Validation</h4>
          <p className="hint">
            Confirm the dwelling address to link this interview to the sample frame record.
          </p>
          <label className="checkbox" style={{ marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={config.includeAddress}
              onChange={() => toggle('includeAddress')}
            />
            Include address confirmation questions
          </label>
          {config.includeAddress && (
            <div className="iv-builder__preview">
              {['Street address — text', 'City / Municipality — text'].map((q, i) => (
                <div key={i} className="iv-builder__q">
                  <span className="iv-builder__q-label">Q{(config.includeAltPhone ? 3 : 2) + i}</span>
                  <span>{q}</span>
                  <span className="iv-builder__q-iv">🎧</span>
                </div>
              ))}
              <label className="checkbox" style={{ margin: '8px 0' }}>
                <input
                  type="checkbox"
                  checked={config.includeProvince}
                  onChange={() => toggle('includeProvince')}
                />
                Include Province / Territory (creates a code list)
              </label>
              {config.includeProvince && (
                <div className="iv-builder__q iv-builder__q--optional">
                  <span className="iv-builder__q-label">Q*</span>
                  <span>Province / Territory — single choice (13 PT codes)</span>
                  <span className="iv-builder__q-iv">🎧</span>
                </div>
              )}
              <div className="iv-builder__q">
                <span className="iv-builder__q-label">Q*</span>
                <span>Postal code — text (pattern A1A 1A1)</span>
                <span className="iv-builder__q-iv">🎧</span>
              </div>
            </div>
          )}
          <div className="iv-builder__nav">
            <button type="button" onClick={() => setStep(1)}>← Back</button>
            <button type="button" className="btn btn--primary" onClick={() => setStep(3)}>Next →</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="iv-builder__body">
          <h4>Step 3 — Configuration</h4>
          <div className="subpanel">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={config.blockMainUntilComplete}
                onChange={() => toggle('blockMainUntilComplete')}
              />
              Block progression to main survey until entry is complete
            </label>
            <label className="checkbox" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={config.showInSelfAdmin}
                onChange={() => toggle('showInSelfAdmin')}
              />
              Show entry module in self-administered mode (removes interviewer-only flag)
            </label>
          </div>
          <div className="subpanel">
            <h4>Summary</h4>
            <ul className="iv-builder__summary">
              <li>Phone confirmation question (boolean)</li>
              {config.includeAltPhone && <li>Alternate phone number (text)</li>}
              {config.includeAddress && (
                <>
                  <li>Street address (text)</li>
                  <li>City / Municipality (text)</li>
                  {config.includeProvince && <li>Province / Territory (code — 13 PT categories)</li>}
                  <li>Postal code (text, validated pattern)</li>
                </>
              )}
            </ul>
            <p className="hint" style={{ marginTop: 8 }}>
              All variables will be prefixed <code>entry_</code> and marked{' '}
              {config.showInSelfAdmin ? 'visible to all.' : 'interviewer-only.'}
            </p>
          </div>
          <div className="iv-builder__nav">
            <button type="button" onClick={() => setStep(2)}>← Back</button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={build}
              disabled={building}
            >
              {building ? 'Building…' : '✓ Create Entry Module'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
