import { useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { Toolbar } from './components/Toolbar.jsx';
import { StructureTree } from './components/StructureTree.jsx';
import { VariablesPanel } from './components/VariablesPanel.jsx';
import { Inspector } from './components/Inspector.jsx';
import { SpecPanel } from './components/SpecPanel.jsx';
import { PreviewPane } from './components/PreviewPane.jsx';
import { FlowPane } from './components/FlowPane.jsx';
import { RespondentApp } from './components/RespondentApp.jsx';

export default function App() {
  const [renderMode, setRenderMode] = useState(false);

  if (renderMode) {
    return <RespondentApp onExit={() => setRenderMode(false)} />;
  }

  return (
    <div className="app">
      <Toolbar onRender={() => setRenderMode(true)} />
      <main className="layout">
        <section className="panel panel--left" aria-label="Structure & variables">
          <Tabs.Root defaultValue="structure" className="tabs">
            <Tabs.List className="tabs__list" aria-label="Left panel">
              <Tabs.Trigger className="tabs__trigger" value="structure">
                Structure
              </Tabs.Trigger>
              <Tabs.Trigger className="tabs__trigger" value="variables">
                Variables
              </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="structure" className="tabs__content">
              <StructureTree />
            </Tabs.Content>
            <Tabs.Content value="variables" className="tabs__content">
              <VariablesPanel />
            </Tabs.Content>
          </Tabs.Root>
        </section>

        <section className="panel panel--center" aria-label="Inspector">
          <Inspector />
        </section>

        <section className="panel panel--right" aria-label="Preview & specification">
          <Tabs.Root defaultValue="preview" className="tabs">
            <Tabs.List className="tabs__list" aria-label="Right panel">
              <Tabs.Trigger className="tabs__trigger" value="preview">
                Preview
              </Tabs.Trigger>
              <Tabs.Trigger className="tabs__trigger" value="flow">
                Flow
              </Tabs.Trigger>
              <Tabs.Trigger className="tabs__trigger" value="spec">
                JSON Spec
              </Tabs.Trigger>
            </Tabs.List>
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
    </div>
  );
}
