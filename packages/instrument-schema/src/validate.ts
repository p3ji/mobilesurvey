/**
 * Instrument validation: Zod shape validation plus cross-reference (referential-integrity)
 * checks that Zod alone cannot express (e.g. "every `variableRef` names a declared variable").
 */
import { instrumentSchema } from './zod.js';
import type {
  ControlConstruct,
  Instrument,
  LoopConstruct,
  QuestionConstruct,
} from './types.js';

export interface ValidationIssue {
  /** Dot/bracket path to the offending node, e.g. `sequence.children[2].variableRef`. */
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; instrument: Instrument }
  | { ok: false; issues: ValidationIssue[] };

/** Walk every construct in the tree, yielding `[node, path]`. */
function* walk(node: ControlConstruct, path: string): Generator<[ControlConstruct, string]> {
  yield [node, path];
  switch (node.type) {
    case 'sequence':
    case 'loop':
      for (let i = 0; i < node.children.length; i++) {
        yield* walk(node.children[i]!, `${path}.children[${i}]`);
      }
      break;
    case 'ifThenElse':
      for (let i = 0; i < node.then.length; i++) {
        yield* walk(node.then[i]!, `${path}.then[${i}]`);
      }
      {
        const elseBranch = node.else ?? [];
        for (let i = 0; i < elseBranch.length; i++) {
          yield* walk(elseBranch[i]!, `${path}.else[${i}]`);
        }
      }
      break;
    default:
      break;
  }
}

/** Referential-integrity checks over an already shape-valid instrument. */
export function checkReferences(instrument: Instrument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const variableNames = new Set(instrument.variables.map((v) => v.name));
  const schemeIds = new Set(instrument.categorySchemes.map((s) => s.id));

  // Duplicate variable names.
  const seen = new Set<string>();
  for (const v of instrument.variables) {
    if (seen.has(v.name)) {
      issues.push({ path: `variables`, message: `Duplicate variable name "${v.name}"` });
    }
    seen.add(v.name);
    if (v.representation === 'code' && v.categorySchemeRef && !schemeIds.has(v.categorySchemeRef)) {
      issues.push({
        path: `variables.${v.name}.categorySchemeRef`,
        message: `Unknown category scheme "${v.categorySchemeRef}"`,
      });
    }
  }

  for (const [node, path] of walk(instrument.sequence, 'sequence')) {
    if (node.type === 'question') {
      const q = node as QuestionConstruct;
      if (!variableNames.has(q.variableRef)) {
        issues.push({
          path: `${path}.variableRef`,
          message: `Question references unknown variable "${q.variableRef}"`,
        });
      }
      const rd = q.responseDomain;
      if (
        (rd.type === 'code' || rd.type === 'lookup') &&
        !schemeIds.has(rd.categorySchemeRef)
      ) {
        issues.push({
          path: `${path}.responseDomain.categorySchemeRef`,
          message: `Unknown category scheme "${rd.categorySchemeRef}"`,
        });
      }
    }
    if (node.type === 'loop') {
      const l = node as LoopConstruct;
      if (!l.countVariableRef && !l.loopWhile?.trim()) {
        issues.push({
          path: `${path}`,
          message: 'A loop needs either `countVariableRef` or `loopWhile`',
        });
      }
      if (l.countVariableRef && !variableNames.has(l.countVariableRef)) {
        issues.push({
          path: `${path}.countVariableRef`,
          message: `Loop references unknown count variable "${l.countVariableRef}"`,
        });
      }
    }
    if (node.type === 'computation' && !variableNames.has(node.targetVariableRef)) {
      issues.push({
        path: `${path}.targetVariableRef`,
        message: `Computation targets unknown variable "${node.targetVariableRef}"`,
      });
    }
  }

  for (const m of instrument.prefillMappings) {
    if (!variableNames.has(m.targetVariable)) {
      issues.push({
        path: `prefillMappings`,
        message: `Pre-fill targets unknown variable "${m.targetVariable}"`,
      });
    }
  }

  return issues;
}

/** Validate unknown input: shape (Zod) then references. */
export function validateInstrument(data: unknown): ValidationResult {
  const parsed = instrumentSchema.safeParse(data);
  if (!parsed.success) {
    const issues: ValidationIssue[] = parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    return { ok: false, issues };
  }
  const instrument = parsed.data as Instrument;
  const refIssues = checkReferences(instrument);
  if (refIssues.length > 0) return { ok: false, issues: refIssues };
  return { ok: true, instrument };
}
