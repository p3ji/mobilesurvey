/**
 * Interviewer Mode — three-panel layout for CATI / field-interviewer survey design.
 *
 * Left:   ModuleMapPanel  — entry / main / exit module zones
 * Center: context-sensitive editor (config, entry builder, exit builder, or standard Inspector)
 * Right:  InterviewerPreview — CATI-style preview with jump navigation
 */
import { useState } from 'react';
import { useDesigner } from '../store/instrumentStore.js';
import { ModuleMapPanel } from './ModuleMapPanel.jsx';
import { EntryModuleBuilder } from './EntryModuleBuilder.jsx';
import { ExitModuleBuilder } from './ExitModuleBuilder.jsx';
import { InterviewerPreview } from './InterviewerPreview.jsx';
import { Inspector } from './Inspector.jsx';
import { Field } from './fields.jsx';

type CenterView = 'config' | 'entry-builder' | 'exit-builder' | 'inspector';

function InterviewerConfigEditor() {
  const instrument = useDesigner((s) => s.instrument);
  const update = useDesigner((s) => s.update);
  const config = instrument.interviewer;

  const patch = (changes: Partial<NonNullable<typeof config>>) => {
    update((d) => {
      d.interviewer = { enabled: true, allowFreeNavigation: true, ...d.interviewer, ...changes };
    });
  };

  return (
    <div className="inspector iv-config">
      <h3>Interviewer Mode Configuration</h3>
      <p className="hint">
        Configure CATI (phone) or field-interviewer settings. Use the Module Map on the left to
        add an <strong>Entry module</strong> (phone/address validation) and an <strong>Exit
        module</strong> (household phone enumeration for coverage weighting).
      </p>

      <div className="subpanel">
        <h4>Settings</h4>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={Boolean(config?.enabled)}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          Enable interviewer mode for this instrument
        </label>
        <label className="checkbox" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={Boolean(config?.allowFreeNavigation)}
            onChange={(e) => patch({ allowFreeNavigation: e.target.checked })}
          />
          Allow free navigation (interviewer can jump to any question)
        </label>
      </div>

      <div className="subpanel">
        <h4>Module references</h4>
        <Field label="Entry module ID" hint="Auto-set when you create an entry module via the Module Map.">
          {(id) => (
            <input
              id={id}
              type="text"
              value={config?.entryModuleRef ?? ''}
              placeholder="(none)"
              onChange={(e) => patch({ entryModuleRef: e.target.value || undefined })}
            />
          )}
        </Field>
        <Field label="Exit module ID" hint="Auto-set when you create an exit module via the Module Map.">
          {(id) => (
            <input
              id={id}
              type="text"
              value={config?.exitModuleRef ?? ''}
              placeholder="(none)"
              onChange={(e) => patch({ exitModuleRef: e.target.value || undefined })}
            />
          )}
        </Field>
      </div>

      <div className="subpanel">
        <h4>How interviewer mode works</h4>
        <ul className="iv-config__list">
          <li>
            <strong>Entry module</strong> — runs before the main survey. Collects phone confirmation
            and address to validate the respondent against the sample frame. Hidden in
            self-administered mode.
          </li>
          <li>
            <strong>Exit module</strong> — runs after the main survey completes. Enumerates all
            phone numbers that reach the household (for dwelling-based coverage weighting). Hidden
            in self-administered mode.
          </li>
          <li>
            <strong>Free navigation</strong> — the Jump-to list on the right lets interviewers skip
            to any question without following routing logic, so they can back-fill or probe earlier
            answers. All jumps are logged as paradata.
          </li>
          <li>
            <strong>Interviewer-only fields</strong> — flag individual questions or sections as
            "Interviewer only" via the Inspector (Pro Mode) to hide them from self-administered
            respondents.
          </li>
        </ul>
      </div>
    </div>
  );
}

export function InterviewerModeView() {
  const [centerView, setCenterView] = useState<CenterView>('config');

  const showInspector = (id: string) => {
    useDesigner.getState().select(id);
    setCenterView('inspector');
  };

  return (
    <div className="iv-layout">
      {/* Left: module map */}
      <aside className="iv-map-panel">
        <ModuleMapPanel
          onConfigClick={() => setCenterView('config')}
          onEntryBuilderClick={() => setCenterView('entry-builder')}
          onExitBuilderClick={() => setCenterView('exit-builder')}
          onQuestionClick={showInspector}
        />
      </aside>

      {/* Center: context editor */}
      <section className="iv-center-panel">
        {centerView === 'config' && <InterviewerConfigEditor />}
        {centerView === 'entry-builder' && (
          <EntryModuleBuilder onDone={() => setCenterView('config')} />
        )}
        {centerView === 'exit-builder' && (
          <ExitModuleBuilder onDone={() => setCenterView('config')} />
        )}
        {centerView === 'inspector' && <Inspector />}
      </section>

      {/* Right: CATI preview with jump nav */}
      <aside className="iv-preview-panel">
        <InterviewerPreview onJumpToQuestion={showInspector} />
      </aside>
    </div>
  );
}
