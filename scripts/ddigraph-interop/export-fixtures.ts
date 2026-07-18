/**
 * ddigraph interop harness, step 1 (docs/ddi-compliance-plan.md §3.5):
 * write FragmentInstance exports of the `demo` and `fsep` bundled instruments plus an
 * expected-entity-count manifest derived from the instrument MODEL (not from the XML),
 * so the Python checker's count assertions are independent of the emission logic.
 *
 * Run: pnpm ddi:interop:fixtures   (tsx; output goes to scripts/ddigraph-interop/out/)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ControlConstruct, Instrument } from '../../packages/instrument-schema/src/index.js';
import { demoInstrument, fsepInstrument } from '../../packages/instrument-schema/src/index.js';
import { exportDdiXml } from '../../packages/ddi-xml/src/index.js';

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');

/** Count the graph nodes ddigraph should see, walking the instrument model. */
function expectedCounts(inst: Instrument): Record<string, number> {
  const acc: Record<string, number> = {
    StudyUnit: 1,
    ConceptualComponent: 1,
    DataCollection: 1,
    LogicalProduct: 1,
    Instrument: 1,
    QuestionScheme: 1,
    ControlConstructScheme: 1,
    InstrumentScheme: 1,
    Sequence: 0,
    QuestionConstruct: 0,
    QuestionItem: 0,
    IfThenElse: 0,
    Loop: 0,
    ComputationItem: 0,
    StatementItem: 0,
  };
  const walk = (c: ControlConstruct): void => {
    switch (c.type) {
      case 'sequence':
        acc.Sequence!++;
        c.children.forEach(walk);
        break;
      case 'question':
        acc.QuestionConstruct!++;
        acc.QuestionItem!++;
        break;
      case 'ifThenElse':
        acc.IfThenElse!++;
        acc.Sequence!++; // synthetic `_then` sequence
        c.then.forEach(walk);
        if (c.else?.length) {
          acc.Sequence!++; // synthetic `_else` sequence
          c.else.forEach(walk);
        }
        break;
      case 'loop':
        acc.Loop!++;
        acc.Sequence!++; // synthetic `_body` sequence
        c.children.forEach(walk);
        break;
      case 'computation':
        acc.ComputationItem!++;
        break;
      case 'statement':
        acc.StatementItem!++;
        break;
    }
  };
  walk(inst.sequence);

  acc.Concept = inst.concepts.length;
  acc.ConceptScheme = inst.concepts.length ? 1 : 0;
  acc.Universe = inst.universes.length;
  acc.UniverseScheme = inst.universes.length ? 1 : 0;
  acc.CategoryScheme = inst.categorySchemes.length;
  acc.CodeList = inst.categorySchemes.length;
  acc.CodeListScheme = inst.categorySchemes.length ? 1 : 0;
  acc.Category = inst.categorySchemes.reduce((n, cs) => n + cs.categories.length, 0);
  acc.Variable = inst.variables.length;
  acc.VariableScheme = inst.variables.length ? 1 : 0;
  return acc;
}

mkdirSync(OUT_DIR, { recursive: true });
const manifest: Record<string, { file: string; agency: string; counts: Record<string, number> }> = {};

for (const [name, inst] of [
  ['demo', demoInstrument],
  ['fsep', fsepInstrument],
] as const) {
  const file = `${name}.ddi-fragments.xml`;
  writeFileSync(path.join(OUT_DIR, file), exportDdiXml(inst, { packaging: 'fragment' }), 'utf8');
  manifest[name] = { file, agency: 'io.github.p3ji', counts: expectedCounts(inst) };
  console.log(`wrote ${file}`);
}

writeFileSync(path.join(OUT_DIR, 'expected.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log('wrote expected.json');
