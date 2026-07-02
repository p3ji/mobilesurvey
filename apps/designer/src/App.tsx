import { useCallback, useEffect, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useDesigner } from './store/instrumentStore.js';
import { currentSurveyId, fetchSurvey } from './lib/surveyApi.js';
import { Toolbar } from './components/Toolbar.jsx';
import { StructureTree } from './components/StructureTree.jsx';
import { VariablesPanel } from './components/VariablesPanel.jsx';
import { LibraryPanel } from './components/LibraryPanel.jsx';
import { Inspector } from './components/Inspector.jsx';
import { SpecPanel } from './components/SpecPanel.jsx';
import { PreviewPane } from './components/PreviewPane.jsx';
import { FlowPane } from './components/FlowPane.jsx';
import { RespondentApp } from './components/RespondentApp.jsx';
import { EasyModeView } from './components/EasyModeView.jsx';
import { InterviewerModeView } from './components/InterviewerModeView.jsx';

const MIN_LEFT = 180;
const MAX_LEFT = 560;
const MIN_RIGHT = 240;
const MAX_RIGHT = 680;

export default function App() {
  const [renderMode, setRenderMode] = useState(false);
  const [mode, setMode] = useState<'pro' | 'easy' | 'interviewer'>(() => {
    const m = new URLSearchParams(window.location.search).get('mode');
    if (m === 'easy') return 'easy';
    if (m === 'interviewer') return 'interviewer';
    return 'pro';
  });
  const [surveyId] = useState<string | null>(currentSurveyId);

  // Resizable panel widths.
  const [leftW, setLeftW] = useState(300);
  const [rightW, setRightW] = useState(420);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  // If opened from the hub with ?survey=<id>, load that survey into the editor.
  useEffect(() => {
    if (!surveyId) return;
    fetchSurvey(surveyId).then((instrument) => {
      if (instrument) useDesigner.getState().load(instrument);
    });
  }, [surveyId]);

  const startDrag = useCallback((side: 'left' | 'right', startX: number, startW: number) => {
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      if (side === 'left') {
        setLeftW(Math.max(MIN_LEFT, Math.min(MAX_LEFT, startW + delta)));
      } else {
        setRightW(Math.max(MIN_RIGHT, Math.min(MAX_RIGHT, startW - delta)));
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  if (renderMode) {
    return <RespondentApp onExit={() => setRenderMode(false)} />;
  }

  const effectiveLeftW = leftCollapsed ? 0 : leftW;
  const effectiveRightW = rightCollapsed ? 0 : rightW;

  return (
    <div className="app">
      <Toolbar
        onRender={() => setRenderMode(true)}
        surveyId={surveyId}
        mode={mode}
        onModeChange={(m) => setMode(m)}
      />

      {mode === 'easy' ? (
        <main className="layout layout--easy">
          <EasyModeView />
        </main>
      ) : mode === 'interviewer' ? (
        <main className="layout layout--interviewer">
          <InterviewerModeView />
        </main>
      ) : (
        <main
          className="layout"
          style={{ gridTemplateColumns: `${effectiveLeftW}px 4px minmax(320px,1fr) 4px ${effectiveRightW}px` }}
        >
          {/* Left panel */}
          <section
            className={leftCollapsed ? 'panel panel--left panel--collapsed' : 'panel panel--left'}
            aria-label="Structure & variables"
            style={{ width: effectiveLeftW, overflow: leftCollapsed ? 'hidden' : undefined }}
          >
            <Tabs.Root defaultValue="structure" className="tabs">
              <div className="tabs__list-row">
                <Tabs.List className="tabs__list" aria-label="Left panel">
                  <Tabs.Trigger className="tabs__trigger" value="structure">Structure</Tabs.Trigger>
                  <Tabs.Trigger className="tabs__trigger" value="variables">Variables</Tabs.Trigger>
                  <Tabs.Trigger className="tabs__trigger" value="library">Library</Tabs.Trigger>
                </Tabs.List>
                <button
                  type="button"
                  className="panel__collapse-btn"
                  aria-label="Collapse left panel"
                  title="Collapse"
                  onClick={() => setLeftCollapsed((c) => !c)}
                >
                  {leftCollapsed ? '▶' : '◀'}
                </button>
              </div>
              <Tabs.Content value="structure" className="tabs__content">
                <StructureTree />
              </Tabs.Content>
              <Tabs.Content value="variables" className="tabs__content">
                <VariablesPanel />
              </Tabs.Content>
              <Tabs.Content value="library" className="tabs__content">
                <LibraryPanel />
              </Tabs.Content>
            </Tabs.Root>
          </section>

          {/* Left drag handle */}
          <div
            className="panel-drag"
            role="separator"
            aria-label="Resize left panel"
            onMouseDown={(e) => {
              e.preventDefault();
              if (leftCollapsed) { setLeftCollapsed(false); return; }
              startDrag('left', e.clientX, leftW);
            }}
            onDoubleClick={() => setLeftCollapsed((c) => !c)}
          />

          {/* Center panel */}
          <section className="panel panel--center" aria-label="Inspector">
            <Inspector />
          </section>

          {/* Right drag handle */}
          <div
            className="panel-drag"
            role="separator"
            aria-label="Resize right panel"
            onMouseDown={(e) => {
              e.preventDefault();
              if (rightCollapsed) { setRightCollapsed(false); return; }
              startDrag('right', e.clientX, rightW);
            }}
            onDoubleClick={() => setRightCollapsed((c) => !c)}
          />

          {/* Right panel */}
          <section
            className={rightCollapsed ? 'panel panel--right panel--collapsed' : 'panel panel--right'}
            aria-label="Preview & specification"
            style={{ width: effectiveRightW, overflow: rightCollapsed ? 'hidden' : undefined }}
          >
            <Tabs.Root defaultValue="preview" className="tabs">
              <div className="tabs__list-row">
                <button
                  type="button"
                  className="panel__collapse-btn"
                  aria-label="Collapse right panel"
                  title="Collapse"
                  onClick={() => setRightCollapsed((c) => !c)}
                >
                  {rightCollapsed ? '◀' : '▶'}
                </button>
                <Tabs.List className="tabs__list" aria-label="Right panel">
                  <Tabs.Trigger className="tabs__trigger" value="preview">Preview</Tabs.Trigger>
                  <Tabs.Trigger className="tabs__trigger" value="flow">Flow</Tabs.Trigger>
                  <Tabs.Trigger className="tabs__trigger" value="spec">JSON Spec</Tabs.Trigger>
                </Tabs.List>
              </div>
              <Tabs.Content value="preview" className="tabs__content">
                <PreviewPane />
              </Tabs.Content>
              <Tabs.Content value="flow" className="tabs__content">
                <FlowPane />
              </Tabs.Content>
              <Tabs.Content value="spec" className="tabs__content">
                <SpecPanel />
              </Tabs.Content>
            </Tabs.Root>
          </section>
        </main>
      )}
    </div>
  );
}
