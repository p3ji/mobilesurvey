/**
 * Library (metadata registry) panel: search reusable components across the bundled surveys and
 * insert a question / section / page (or a code list / variable) into the current instrument.
 * Inserting a construct also copies any variable + code-list dependencies it needs.
 */
import { useMemo, useState } from 'react';
import {
  buildCatalog,
  buildSearchIndex,
  search,
  type ComponentType,
} from '@mobilesurvey/metadata-registry';
import {
  demoInstrument,
  householdInstrument,
  lfsInstrument,
  type CategoryScheme,
  type ControlConstruct,
  type Instrument,
  type Variable,
} from '@mobilesurvey/instrument-schema';
import { pick } from '@mobilesurvey/runtime-engine';
import { useDesigner } from '../store/instrumentStore.js';
import { addChild, findNode, genId, insertAfter, isContainer } from '../lib/tree.js';

/** The bundled surveys that make up the reusable library. */
const CATALOG: Instrument[] = [lfsInstrument, demoInstrument, householdInstrument];

const TYPE_FILTERS: Array<{ value: ComponentType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'question', label: 'Questions' },
  { value: 'section', label: 'Sections' },
  { value: 'page', label: 'Pages' },
  { value: 'codeList', label: 'Code lists' },
  { value: 'variable', label: 'Variables' },
];

const TYPE_ICON: Record<ComponentType, string> = {
  instrument: '▣',
  page: '□',
  section: '▤',
  question: '?',
  variable: 'ν',
  codeList: '≣',
};

/** Recursively assign fresh ids to a cloned construct subtree. */
function regenIds(node: ControlConstruct): void {
  const prefix =
    node.type === 'question'
      ? 'q'
      : node.type === 'sequence'
        ? node.isPage
          ? 'pg'
          : 'seq'
        : node.type === 'ifThenElse'
          ? 'if'
          : node.type;
  node.id = genId(prefix);
  if (node.type === 'sequence' || node.type === 'loop') node.children.forEach(regenIds);
  if (node.type === 'ifThenElse') {
    node.then.forEach(regenIds);
    (node.else ?? []).forEach(regenIds);
  }
}

/** Collect variable names + category-scheme ids referenced anywhere in a construct subtree. */
function collectRefs(node: ControlConstruct, vars: Set<string>, schemes: Set<string>): void {
  if (node.type === 'question') {
    if (node.variableRef) vars.add(node.variableRef);
    const rd = node.responseDomain;
    if (rd.type === 'code' || rd.type === 'lookup' || rd.type === 'markAll') schemes.add(rd.categorySchemeRef);
  } else if (node.type === 'loop') {
    if (node.countVariableRef) vars.add(node.countVariableRef);
    node.children.forEach((c) => collectRefs(c, vars, schemes));
  } else if (node.type === 'sequence') {
    node.children.forEach((c) => collectRefs(c, vars, schemes));
  } else if (node.type === 'ifThenElse') {
    node.then.forEach((c) => collectRefs(c, vars, schemes));
    (node.else ?? []).forEach((c) => collectRefs(c, vars, schemes));
  } else if (node.type === 'computation') {
    if (node.targetVariableRef) vars.add(node.targetVariableRef);
  }
}

export function LibraryPanel() {
  const language = useDesigner((s) => s.language);
  const selectedId = useDesigner((s) => s.selectedId);
  const select = useDesigner((s) => s.select);
  const update = useDesigner((s) => s.update);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ComponentType | 'all'>('all');
  const [note, setNote] = useState<string | null>(null);

  const { entries, index, byId } = useMemo(() => {
    const entries = buildCatalog(CATALOG);
    return {
      entries,
      index: buildSearchIndex(entries),
      byId: new Map(CATALOG.map((i) => [i.id, i])),
    };
  }, []);

  const hits = useMemo(() => {
    if (query.trim() === '') {
      // No query: show a sample of the catalog (respecting the type filter).
      return entries
        .filter((e) => (filter === 'all' ? e.componentType !== 'instrument' : e.componentType === filter))
        .slice(0, 30)
        .map((entry) => ({ entry, score: 0, matched: [] as string[] }));
    }
    return search(index, query, { limit: 40, type: filter === 'all' ? undefined : filter });
  }, [query, filter, index, entries]);

  const sourceTitle = (provenance?: string): string => {
    const inst = provenance ? byId.get(provenance) : undefined;
    return inst ? pick(inst.metadata.title, language) : '';
  };

  const insert = (entryId: string) => {
    const entry = entries.find((e) => e.entryId === entryId);
    if (!entry) return;
    const src = entry.registry.provenance ? byId.get(entry.registry.provenance) : undefined;

    update((draft) => {
      if (entry.componentType === 'codeList') {
        const scheme = structuredClone(entry.payload) as CategoryScheme;
        if (!draft.categorySchemes.some((c) => c.id === scheme.id)) draft.categorySchemes.push(scheme);
        return;
      }
      if (entry.componentType === 'variable') {
        const variable = structuredClone(entry.payload) as Variable;
        if (!draft.variables.some((v) => v.name === variable.name)) draft.variables.push(variable);
        return;
      }

      // question / section / page → insert a construct, copying its dependencies.
      const clone = structuredClone(entry.payload) as ControlConstruct;
      const vars = new Set<string>();
      const schemes = new Set<string>();
      collectRefs(clone, vars, schemes);
      for (const name of vars) {
        if (!draft.variables.some((v) => v.name === name)) {
          const sv = src?.variables.find((v) => v.name === name);
          if (sv) draft.variables.push(structuredClone(sv));
        }
      }
      for (const id of schemes) {
        if (!draft.categorySchemes.some((c) => c.id === id)) {
          const ss = src?.categorySchemes.find((c) => c.id === id);
          if (ss) draft.categorySchemes.push(structuredClone(ss));
        }
      }
      regenIds(clone);

      const sel = selectedId ? findNode(draft.sequence, selectedId) : null;
      if (sel && isContainer(sel)) addChild(draft.sequence, sel.id, clone);
      else if (sel && sel.id !== draft.sequence.id) insertAfter(draft.sequence, sel.id, clone);
      else draft.sequence.children.push(clone);

      // Defer selection until after the state update commits.
      queueMicrotask(() => select(clone.id));
    });

    setNote(`Inserted “${entryLabel(entry)}”.`);
    window.setTimeout(() => setNote(null), 2500);
  };

  const entryLabel = (e: (typeof entries)[number]): string =>
    pick(e.ddi.label, language) || e.searchText.split(' · ')[0] || e.entryId;

  return (
    <div className="lib">
      <p className="lib__intro">
        Reuse questions and components from your other surveys. Search, then insert into the current
        instrument (dependencies are copied automatically).
      </p>

      <input
        className="lib__search"
        type="search"
        value={query}
        placeholder="Search the library (e.g. occupation, satisfaction, industry)…"
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="lib__filters" role="group" aria-label="Filter by type">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={filter === f.value ? 'lib__chip lib__chip--on' : 'lib__chip'}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {note && <div className="lib__note" role="status">{note}</div>}

      <ul className="lib__list">
        {hits.length === 0 && <li className="lib__empty">No matching components.</li>}
        {hits.map(({ entry, matched }) => (
          <li key={entry.entryId} className="lib__item">
            <div className="lib__item-main">
              <span className="lib__icon" aria-hidden="true">{TYPE_ICON[entry.componentType]}</span>
              <div className="lib__item-text">
                <span className="lib__label">{entryLabel(entry)}</span>
                <span className="lib__meta">
                  {entry.componentType}
                  {entry.registry.provenance ? ` · ${sourceTitle(entry.registry.provenance)}` : ''}
                  {entry.registry.usageCount ? ` · used ×${entry.registry.usageCount}` : ''}
                  {matched.length ? ` · matched: ${matched.join(', ')}` : ''}
                </span>
              </div>
            </div>
            {entry.componentType !== 'instrument' && (
              <button type="button" className="lib__insert" onClick={() => insert(entry.entryId)}>
                + Insert
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
