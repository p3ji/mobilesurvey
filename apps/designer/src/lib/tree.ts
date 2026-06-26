/**
 * Pure helpers for navigating and mutating the control-construct tree. The mutating helpers are
 * designed to run inside an Immer `produce` recipe (they mutate the draft in place).
 */
import type {
  ControlConstruct,
  Instrument,
  Variable,
} from '@mobilesurvey/instrument-schema';

let counter = 0;
/** Generate a short unique id with a type prefix. */
export function genId(prefix: string): string {
  counter += 1;
  return `${prefix}.${Date.now().toString(36)}${counter.toString(36)}`;
}

/** The child arrays a construct owns (sequence/loop → children; ifThenElse → then + else). */
export function childArrays(node: ControlConstruct): ControlConstruct[][] {
  if (node.type === 'sequence' || node.type === 'loop') return [node.children];
  if (node.type === 'ifThenElse') {
    if (!node.else) node.else = [];
    return [node.then, node.else];
  }
  return [];
}

export type Located = { node: ControlConstruct; container: ControlConstruct[]; index: number };

/** Find a node (and its containing array) by id. Returns null for the root or unknown ids. */
export function locate(root: ControlConstruct, id: string): Located | null {
  for (const arr of childArrays(root)) {
    for (let i = 0; i < arr.length; i++) {
      const child = arr[i]!;
      if (child.id === id) return { node: child, container: arr, index: i };
      const deeper = locate(child, id);
      if (deeper) return deeper;
    }
  }
  return null;
}

/** Find a node by id, including the root itself. */
export function findNode(root: ControlConstruct, id: string): ControlConstruct | null {
  if (root.id === id) return root;
  return locate(root, id)?.node ?? null;
}

/** True if a construct type can contain children. */
export function isContainer(node: ControlConstruct): boolean {
  return node.type === 'sequence' || node.type === 'loop' || node.type === 'ifThenElse';
}

export type AddableType =
  | 'question'
  | 'sequence'
  | 'page'
  | 'ifThenElse'
  | 'loop'
  | 'computation'
  | 'statement';

const en = (s: string) => ({ en: s, fr: s });

/** Build a blank construct of the given type with sensible defaults and fresh ids. */
export function createConstruct(type: AddableType): ControlConstruct {
  switch (type) {
    case 'question':
      return {
        type: 'question',
        id: genId('q'),
        variableRef: '',
        text: en('New question'),
        responseDomain: { type: 'text' },
      };
    case 'sequence':
      return { type: 'sequence', id: genId('seq'), label: en('New section'), children: [] };
    case 'page':
      return { type: 'sequence', id: genId('pg'), label: en('New page'), children: [], isPage: true };
    case 'ifThenElse':
      return { type: 'ifThenElse', id: genId('if'), condition: '', then: [], else: [] };
    case 'loop':
      return {
        type: 'loop',
        id: genId('loop'),
        label: en('New roster'),
        loopVariable: 'i',
        itemLabel: en('Item ${i}'),
        countVariableRef: '',
        children: [],
      };
    case 'computation':
      return { type: 'computation', id: genId('comp'), targetVariableRef: '', expression: '' };
    case 'statement':
      return { type: 'statement', id: genId('stmt'), text: en('New statement') };
  }
}

/** Append a child to a container node (ifThenElse defaults to the `then` branch). */
export function addChild(
  root: ControlConstruct,
  parentId: string,
  child: ControlConstruct,
  branch: 'then' | 'else' = 'then',
): boolean {
  const parent = findNode(root, parentId);
  if (!parent) return false;
  if (parent.type === 'sequence' || parent.type === 'loop') {
    parent.children.push(child);
    return true;
  }
  if (parent.type === 'ifThenElse') {
    if (branch === 'else') {
      if (!parent.else) parent.else = [];
      parent.else.push(child);
    } else {
      parent.then.push(child);
    }
    return true;
  }
  return false;
}

/** Remove a node by id. */
export function removeNode(root: ControlConstruct, id: string): boolean {
  const found = locate(root, id);
  if (!found) return false;
  found.container.splice(found.index, 1);
  return true;
}

/** Insert `newNode` as a sibling immediately after the node with `siblingId`. */
export function insertAfter(
  root: ControlConstruct,
  siblingId: string,
  newNode: ControlConstruct,
): boolean {
  const found = locate(root, siblingId);
  if (!found) return false;
  found.container.splice(found.index + 1, 0, newNode);
  return true;
}

/** Move a node up (-1) or down (+1) among its siblings. */
export function moveNode(root: ControlConstruct, id: string, direction: -1 | 1): boolean {
  const found = locate(root, id);
  if (!found) return false;
  const next = found.index + direction;
  if (next < 0 || next >= found.container.length) return false;
  const [item] = found.container.splice(found.index, 1);
  found.container.splice(next, 0, item!);
  return true;
}

/** Walk the tree in document order and return a map of questionId → sequential number. */
export function buildQNumMap(root: ControlConstruct): Map<string, number> {
  const map = new Map<string, number>();
  let n = 0;
  function walk(node: ControlConstruct) {
    if (node.type === 'question') { map.set(node.id, ++n); return; }
    if (node.type === 'sequence' || node.type === 'loop') node.children.forEach(walk);
    else if (node.type === 'ifThenElse') { node.then.forEach(walk); (node.else ?? []).forEach(walk); }
  }
  walk(root);
  return map;
}

/** Create a blank variable with a unique name. */
export function createVariable(instrument: Instrument): Variable {
  const existing = new Set(instrument.variables.map((v) => v.name));
  let n = instrument.variables.length + 1;
  let name = `var${n}`;
  while (existing.has(name)) {
    n += 1;
    name = `var${n}`;
  }
  return {
    id: genId('v'),
    name,
    kind: 'collected',
    label: en(name),
    representation: 'text',
  };
}
