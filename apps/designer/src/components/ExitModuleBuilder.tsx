/**
 * Exit Module Builder — wizard that scaffolds a post-interview housekeeping sequence.
 *
 * Generates:
 *   Step 1 — Household phone count (how many numbers reach this dwelling?)
 *   Step 2 — Dwelling classification (type + units in building)
 *   Step 3 — Configuration (auto-weight, always show)
 *
 * The sequence is appended to the root with moduleKind='exit', interviewerOnly=true.
 * The dwelling-based coverage weight `weight_dwelling = 1 / exit_phone_count` is optionally
 * added as a derived variable for use in post-processing.
 */
import { useState } from 'react';
import type { ControlConstruct, LoopConstruct, SequenceConstruct, Variable } from '@mobilesurvey/instrument-schema';
import { useDesigner } from '../store/instrumentStore.js';
import { genId } from '../lib/tree.js';

interface Props {
  onDone: () => void;
}

interface ExitConfig {
  includeOtherPhones: boolean;
  includeDwellingType: boolean;
  includeUnitsInBuilding: boolean;
  autoWeight: boolean;
  alwaysShow: boolean;
}

const DEFAULT_CONFIG: ExitConfig = {
  includeOtherPhones: true,
  includeDwellingType: true,
  includeUnitsInBuilding: true,
  autoWeight: true,
  alwaysShow: false,
};

const DWELLING_TYPES = [
  { code: 'single', label: 'Single-family detached' },
  { code: 'semi',   label: 'Semi-detached / duplex' },
  { code: 'apt',    label: 'Apartment / condo (5+ units)' },
  { code: 'row',    label: 'Row house / townhouse' },
  { code: 'mobile', label: 'Mobile home' },
  { code: 'other',  label: 'Other' },
];

export function ExitModuleBuilder({ onDone }: Props) {
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState<ExitConfig>(DEFAULT_CONFIG);
  const [building, setBuilding] = useState(false);
  const update = useDesigner((s) => s.update);

  const toggle = (key: keyof ExitConfig) =>
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
        extra?: Partial<Variable>,
      ): Variable => {
        const existing = draft.variables.find((v) => v.name === name);
        if (existing) return existing;
        const v: Variable = {
          id: genId('v'),
          name,
          kind: 'collected',
          label: il(labelEn, labelFr),
          representation: rep,
          interviewerOnly: true,
          ...extra,
        };
        newVars.push(v);
        return v;
      };

      // ── Dwelling type category scheme ─────────────────────────────────────
      let dwellingSchemeId = 'cs_dwelling_type';
      if (config.includeDwellingType) {
        if (!draft.categorySchemes.find((s) => s.id === dwellingSchemeId)) {
          draft.categorySchemes.push({
            id: dwellingSchemeId,
            label: il('Dwelling type', 'Type de logement'),
            categories: DWELLING_TYPES.map(({ code, label }) => ({ code, label: il(label) })),
          });
        }
      }

      // ── Questions / constructs ────────────────────────────────────────────
      const children: ControlConstruct[] = [];

      // Phone count
      addVar('exit_phone_count', 'Number of telephone lines reaching this household', "Nombre de lignes téléphoniques atteignant ce ménage", 'numeric');
      children.push({
        type: 'question',
        id: genId('q'),
        variableRef: 'exit_phone_count',
        text: il(
          'Including the number we called, how many telephone numbers can reach someone in this household?',
          "En incluant le numéro que nous avons composé, combien de numéros de téléphone peuvent rejoindre quelqu'un dans ce ménage ?",
        ),
        instruction: il(
          'Count all landline and mobile numbers that would reach this dwelling, including the one we used for this interview.',
          'Comptez toutes les lignes fixes et mobiles qui atteignent ce logement, y compris celle utilisée pour cette entrevue.',
        ),
        responseDomain: { type: 'numeric', min: 1, max: 20 },
        required: true,
        interviewerOnly: true,
      });

      // Other phone numbers roster
      if (config.includeOtherPhones) {
        // Derived count of other phones
        addVar('exit_other_phone_count', 'Other phone numbers (excluding the one we called)', 'Autres numéros (sauf le numéro composé)', 'numeric', {
          kind: 'derived',
          compute: 'exit_phone_count - 1',
        });

        const loopChildren: ControlConstruct[] = [];
        addVar('exit_phone_other', 'Other telephone number', 'Autre numéro de téléphone', 'text');
        loopChildren.push({
          type: 'question',
          id: genId('q'),
          variableRef: 'exit_phone_other',
          text: il(
            'What is the other telephone number for this household?',
            "Quel est l'autre numéro de téléphone de ce ménage ?",
          ),
          responseDomain: { type: 'text', pattern: '^[0-9\\-\\+\\s\\(\\)]{7,15}$' },
          interviewerOnly: true,
        });

        const rosterId = genId('loop');
        const roster: LoopConstruct = {
          type: 'loop',
          id: rosterId,
          label: il('Other household phone numbers', 'Autres numéros de téléphone du ménage'),
          loopVariable: 'p',
          countVariableRef: 'exit_other_phone_count',
          itemLabel: il('Other number ${p}', 'Autre numéro ${p}'),
          children: loopChildren,
          visibleWhen: 'exit_phone_count > 1',
        };
        children.push(roster);
      }

      if (config.includeDwellingType) {
        addVar('exit_dwelling_type', 'Type of dwelling', 'Type de logement', 'code', {
          categorySchemeRef: dwellingSchemeId,
        });
        children.push({
          type: 'question',
          id: genId('q'),
          variableRef: 'exit_dwelling_type',
          text: il(
            'Which of the following best describes the type of dwelling at this address?',
            'Laquelle des descriptions suivantes correspond le mieux au type de logement à cette adresse ?',
          ),
          responseDomain: { type: 'code', categorySchemeRef: dwellingSchemeId, selection: 'single' },
          interviewerOnly: true,
        });

        if (config.includeUnitsInBuilding) {
          addVar('exit_units_in_building', 'Approximate number of units sharing this address', 'Nombre approximatif de logements à cette adresse', 'numeric');
          children.push({
            type: 'question',
            id: genId('q'),
            variableRef: 'exit_units_in_building',
            text: il(
              'Approximately how many households share this building or address?',
              'Approximativement, combien de ménages partagent ce bâtiment ou cette adresse ?',
            ),
            responseDomain: { type: 'numeric', min: 1 },
            visibleWhen: "exit_dwelling_type IN ['apt', 'row', 'other']",
            interviewerOnly: true,
          });
        }
      }

      // Auto coverage weight
      if (config.autoWeight) {
        addVar('weight_dwelling', 'Dwelling coverage weight (1 / phone count)', 'Pondération de couverture du logement (1 / nombre de téléphones)', 'numeric', {
          kind: 'derived',
          compute: '1 / exit_phone_count',
          interviewerOnly: false,
        });
        children.push({
          type: 'computation',
          id: genId('comp'),
          targetVariableRef: 'weight_dwelling',
          expression: '1 / exit_phone_count',
        });
      }

      // ── Assemble exit sequence ────────────────────────────────────────────
      const seqId = genId('exit');
      const exitSeq: SequenceConstruct = {
        type: 'sequence',
        id: seqId,
        label: il('Exit — Household Coverage', 'Sortie — Couverture du ménage'),
        moduleKind: 'exit',
        interviewerOnly: true,
        children,
      };

      // Append variables
      draft.variables.push(...newVars);

      // Append exit sequence to root
      draft.sequence.children.push(exitSeq);

      // Update interviewer config
      if (!draft.interviewer) {
        draft.interviewer = { enabled: true, allowFreeNavigation: true };
      }
      draft.interviewer.exitModuleRef = seqId;
    });

    setBuilding(false);
    onDone();
  };

  return (
    <div className="inspector iv-builder">
      <div className="iv-builder__header">
        <h3>Exit Module Builder</h3>
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
          <h4>Step 1 — Household Phone Enumeration</h4>
          <p className="hint">
            Enumerating all phone numbers that can reach this dwelling allows you to apply a
            coverage correction weight in post-processing (dwelling-based sample weighting).
          </p>
          <div className="iv-builder__preview">
            <div className="iv-builder__q">
              <span className="iv-builder__q-label">Q*</span>
              <span>
                "Including the number we called, how many telephone numbers can reach this
                household?" — <em>numeric (1–20)</em>
              </span>
              <span className="iv-builder__q-iv">🎧</span>
            </div>
            <label className="checkbox" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={config.includeOtherPhones}
                onChange={() => toggle('includeOtherPhones')}
              />
              Collect the other numbers via a roster (loops over count − 1)
            </label>
            {config.includeOtherPhones && (
              <div className="iv-builder__q iv-builder__q--optional">
                <span className="iv-builder__q-label">↻</span>
                <span>Roster: "Other telephone number #{'{p}'}" — text (pattern validated)</span>
                <span className="iv-builder__q-iv">🎧</span>
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
          <h4>Step 2 — Dwelling Classification</h4>
          <p className="hint">
            Classifying the dwelling type helps post-processing identify shared-address units
            for coverage and non-response adjustment.
          </p>
          <label className="checkbox" style={{ marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={config.includeDwellingType}
              onChange={() => toggle('includeDwellingType')}
            />
            Include dwelling type question (creates a 6-category code list)
          </label>
          {config.includeDwellingType && (
            <>
              <div className="iv-builder__preview">
                <div className="iv-builder__q">
                  <span className="iv-builder__q-label">Q*</span>
                  <span>
                    "Which describes the type of dwelling at this address?" — single choice
                    ({DWELLING_TYPES.map((d) => d.code).join(', ')})
                  </span>
                  <span className="iv-builder__q-iv">🎧</span>
                </div>
              </div>
              <label className="checkbox" style={{ marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={config.includeUnitsInBuilding}
                  onChange={() => toggle('includeUnitsInBuilding')}
                />
                Ask number of units in building (shown only for apt / row / other)
              </label>
              {config.includeUnitsInBuilding && (
                <div className="iv-builder__q iv-builder__q--optional">
                  <span className="iv-builder__q-label">Q*</span>
                  <span>
                    "How many households share this building?" — numeric · visible when apt/row/other
                  </span>
                  <span className="iv-builder__q-iv">🎧</span>
                </div>
              )}
            </>
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
                checked={config.autoWeight}
                onChange={() => toggle('autoWeight')}
              />
              Auto-calculate coverage weight (<code>weight_dwelling = 1 / exit_phone_count</code>)
            </label>
            <p className="hint" style={{ marginTop: 4 }}>
              Adds a derived variable for simple Kish-grid telephone weighting.
            </p>
            <label className="checkbox" style={{ marginTop: 10 }}>
              <input
                type="checkbox"
                checked={config.alwaysShow}
                onChange={() => toggle('alwaysShow')}
              />
              Collect exit module even on incomplete interviews
            </label>
          </div>
          <div className="subpanel">
            <h4>Summary — variables to be created</h4>
            <ul className="iv-builder__summary">
              <li><code>exit_phone_count</code> — numeric (required)</li>
              {config.includeOtherPhones && (
                <>
                  <li><code>exit_other_phone_count</code> — derived (count − 1)</li>
                  <li><code>exit_phone_other</code> — text (in roster, indexed by <code>$p</code>)</li>
                </>
              )}
              {config.includeDwellingType && (
                <>
                  <li><code>exit_dwelling_type</code> — code (6-category scheme)</li>
                  {config.includeUnitsInBuilding && (
                    <li><code>exit_units_in_building</code> — numeric (conditional)</li>
                  )}
                </>
              )}
              {config.autoWeight && (
                <li><code>weight_dwelling</code> — derived (1 / exit_phone_count)</li>
              )}
            </ul>
          </div>
          <div className="iv-builder__nav">
            <button type="button" onClick={() => setStep(2)}>← Back</button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={build}
              disabled={building}
            >
              {building ? 'Building…' : '✓ Create Exit Module'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
