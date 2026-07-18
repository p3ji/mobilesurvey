/**
 * Instrument validation: Zod shape validation plus cross-reference (referential-integrity)
 * checks that Zod alone cannot express (e.g. "every `variableRef` names a declared variable").
 */
import { instrumentSchema } from './zod.js';
import { SENSOR_CONSENT_VARIABLES, TABLE_TOTAL_CODE } from './types.js';
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
  const schemeById = new Map(instrument.categorySchemes.map((s) => [s.id, s]));
  const seenPrefixes = new Map<string, string>(); // variablePrefix -> first path using it

  // Reserved names: the runtime writes per-sensor consent decisions into these.
  const consentNames = new Set<string>(Object.values(SENSOR_CONSENT_VARIABLES));

  // Duplicate variable names.
  const seen = new Set<string>();
  for (const v of instrument.variables) {
    if (consentNames.has(v.name)) {
      issues.push({
        path: `variables.${v.name}`,
        message: `Variable name "${v.name}" is reserved for the runtime's sensor-consent record`,
      });
    }
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
      if (rd.type === 'grid' || rd.type === 'table') {
        for (const [refKey, ref] of [
          ['rowSchemeRef', rd.rowSchemeRef],
          ['colSchemeRef', rd.colSchemeRef],
        ] as const) {
          if (!schemeIds.has(ref)) {
            issues.push({
              path: `${path}.responseDomain.${refKey}`,
              message: `Unknown category scheme "${ref}"`,
            });
          }
        }
        const prior = seenPrefixes.get(rd.variablePrefix);
        if (prior) {
          issues.push({
            path: `${path}.responseDomain.variablePrefix`,
            message: `variablePrefix "${rd.variablePrefix}" is already used at ${prior}; generated variable names would collide`,
          });
        } else {
          seenPrefixes.set(rd.variablePrefix, path);
        }
      }
      if (rd.type === 'markAll') {
        const prior = seenPrefixes.get(rd.variablePrefix);
        if (prior) {
          issues.push({
            path: `${path}.responseDomain.variablePrefix`,
            message: `variablePrefix "${rd.variablePrefix}" is already used at ${prior}; generated variable names would collide`,
          });
        } else {
          seenPrefixes.set(rd.variablePrefix, path);
        }
      }
      if (rd.type === 'geolocation' || rd.type === 'photo') {
        // Sensor captures generate `{variableRef}_LAT` etc., so the variableRef doubles as
        // a generated-name prefix and must not collide with markAll/grid/table prefixes.
        const prior = seenPrefixes.get(q.variableRef);
        if (prior) {
          issues.push({
            path: `${path}.variableRef`,
            message: `variableRef "${q.variableRef}" is already used as a variablePrefix at ${prior}; generated variable names would collide`,
          });
        } else {
          seenPrefixes.set(q.variableRef, path);
        }
        const neededKind = rd.type === 'geolocation' ? 'geolocation' : 'camera';
        const declared = instrument.sensors?.sensors.some((s) => s.kind === neededKind);
        if (!declared) {
          issues.push({
            path: `${path}.responseDomain`,
            message: `${rd.type} question requires a matching "${neededKind}" declaration in \`sensors\` (consent purpose text); the runtime refuses undeclared sensors`,
          });
        }
      }
      if (rd.type === 'table') {
        const rowScheme = schemeById.get(rd.rowSchemeRef);
        const colScheme = schemeById.get(rd.colSchemeRef);
        const rowCodes = new Set(rowScheme?.categories.map((c) => c.code) ?? []);
        const colCodes = new Set(colScheme?.categories.map((c) => c.code) ?? []);
        for (const cell of rd.disabledCells ?? []) {
          const [rowCode, colCode] = cell.split(':');
          if (rowScheme && !rowCodes.has(rowCode!)) {
            issues.push({
              path: `${path}.responseDomain.disabledCells`,
              message: `Disabled cell "${cell}" names unknown row code "${rowCode}"`,
            });
          }
          if (colScheme && !colCodes.has(colCode!)) {
            issues.push({
              path: `${path}.responseDomain.disabledCells`,
              message: `Disabled cell "${cell}" names unknown column code "${colCode}"`,
            });
          }
        }
        if (rd.totalRow && rowCodes.has(TABLE_TOTAL_CODE)) {
          issues.push({
            path: `${path}.responseDomain.rowSchemeRef`,
            message: `Row scheme "${rd.rowSchemeRef}" uses reserved code "${TABLE_TOTAL_CODE}" while totalRow is enabled`,
          });
        }
        if (rd.totalCol && colCodes.has(TABLE_TOTAL_CODE)) {
          issues.push({
            path: `${path}.responseDomain.colSchemeRef`,
            message: `Column scheme "${rd.colSchemeRef}" uses reserved code "${TABLE_TOTAL_CODE}" while totalCol is enabled`,
          });
        }
        for (const [schemeName, scheme] of [
          ['row', rowScheme],
          ['col', colScheme],
        ] as const) {
          for (const c of scheme?.categories ?? []) {
            if (c.code.includes('_')) {
              issues.push({
                path: `${path}.responseDomain.${schemeName}SchemeRef`,
                message: `Category code "${c.code}" contains "_", which makes generated cell variable names ambiguous`,
              });
            }
          }
        }
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
