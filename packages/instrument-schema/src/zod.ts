/**
 * Zod mirror of `./types.ts` — the runtime-validation source of truth.
 *
 * Kept structurally identical to the TypeScript types; `validate.ts` uses this to check imported
 * JSON, and `jsonSchema.ts` derives a JSON Schema artifact from it.
 */
import { z } from 'zod';
import type { ControlConstruct } from './types.js';

export const languageCodeSchema = z.string().min(2);

export const internationalStringSchema = z
  .record(z.string(), z.string())
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one language is required' });

export const idSchema = z.string().min(1);
export const expressionSchema = z.string();

export const conceptSchema = z.object({
  id: idSchema,
  label: internationalStringSchema,
  description: internationalStringSchema.optional(),
});

export const universeSchema = z.object({
  id: idSchema,
  label: internationalStringSchema,
  clause: expressionSchema.optional(),
});

export const categorySchema = z.object({
  code: z.string().min(1),
  label: internationalStringSchema,
});

export const categorySchemeSchema = z.object({
  id: idSchema,
  label: internationalStringSchema,
  categories: z.array(categorySchema),
});

export const variableKindSchema = z.enum(['collected', 'hidden', 'derived']);
export const representationTypeSchema = z.enum([
  'code',
  'numeric',
  'text',
  'datetime',
  'boolean',
  'file',
]);

export const variableSchema = z
  .object({
    id: idSchema,
    name: z
      .string()
      .min(1)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Variable names must be valid identifiers'),
    kind: variableKindSchema,
    label: internationalStringSchema,
    representation: representationTypeSchema,
    conceptRef: idSchema.optional(),
    categorySchemeRef: idSchema.optional(),
    compute: expressionSchema.optional(),
    interviewerOnly: z.boolean().optional(),
    isPII: z.boolean().optional(),
  })
  .refine((v) => v.kind !== 'derived' || (v.compute?.trim().length ?? 0) > 0, {
    message: 'derived variables must define a `compute` expression',
    path: ['compute'],
  });

export const responseDomainSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('code'),
    categorySchemeRef: idSchema,
    selection: z.enum(['single', 'multiple']),
  }),
  z.object({
    type: z.literal('numeric'),
    min: z.number().optional(),
    max: z.number().optional(),
    decimals: z.number().int().min(0).optional(),
    unit: internationalStringSchema.optional(),
  }),
  z.object({
    type: z.literal('text'),
    multiline: z.boolean().optional(),
    maxLength: z.number().int().positive().optional(),
    pattern: z.string().optional(),
  }),
  z.object({ type: z.literal('datetime'), mode: z.enum(['date', 'time', 'datetime']) }),
  z.object({ type: z.literal('boolean') }),
  z.object({
    type: z.literal('file'),
    accept: z.array(z.string()).optional(),
    maxSizeMb: z.number().positive().optional(),
  }),
  z.object({
    type: z.literal('lookup'),
    categorySchemeRef: idSchema,
    hierarchical: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('markAll'),
    categorySchemeRef: idSchema,
    variablePrefix: z.string().min(1, 'variablePrefix is required'),
  }),
  z.object({
    type: z.literal('grid'),
    rowSchemeRef: idSchema,
    colSchemeRef: idSchema,
    variablePrefix: z.string().min(1, 'variablePrefix is required'),
  }),
  z.object({
    type: z.literal('table'),
    rowSchemeRef: idSchema,
    colSchemeRef: idSchema,
    variablePrefix: z.string().min(1, 'variablePrefix is required'),
    unit: internationalStringSchema.optional(),
    decimals: z.number().int().min(0).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    totalRow: z.boolean().optional(),
    totalCol: z.boolean().optional(),
    disabledCells: z
      .array(z.string().regex(/^[^:]+:[^:]+$/, 'Use ROWCODE:COLCODE'))
      .optional(),
  }),
  z.object({
    type: z.literal('geolocation'),
    precision: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
    maxAccuracyM: z.number().positive().optional(),
    manualFallback: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('photo'),
    facing: z.enum(['environment', 'user']).optional(),
    allowLibrary: z.boolean().optional(),
    maxEdgePx: z.number().int().min(200).max(8000).optional(),
    recognition: z
      .object({
        profile: z.enum(['food', 'document', 'generic']),
        variablePrefix: z.string().min(1, 'variablePrefix is required'),
        itemSchemeRef: idSchema.optional(),
        maxItems: z.number().int().min(1).max(20).optional(),
      })
      .optional(),
  }),
]);

export const editTypeSchema = z.enum(['hard', 'soft']);

export const editRuleSchema = z.object({
  id: idSchema,
  type: editTypeSchema,
  when: expressionSchema.min(1, 'Edit condition cannot be empty'),
  message: internationalStringSchema,
  scope: z.array(z.string()).optional(),
});

// Recursive control-construct union. Only this reference is wrapped in `z.lazy` so the child
// object schemas (declared below) can embed it before it is fully defined. The option schemas
// themselves must be plain ZodObjects so `discriminatedUnion` can read their `type` discriminator.
export const controlConstructSchema: z.ZodType<ControlConstruct> = z.lazy(() =>
  z.discriminatedUnion('type', [
    questionConstructSchema,
    sequenceConstructSchema,
    ifThenElseConstructSchema,
    loopConstructSchema,
    computationConstructSchema,
    statementConstructSchema,
  ]),
);

export const questionConstructSchema = z.object({
  type: z.literal('question'),
  id: idSchema,
  variableRef: z.string().min(1),
  text: internationalStringSchema,
  instruction: internationalStringSchema.optional(),
  tooltip: internationalStringSchema.optional(),
  responseDomain: responseDomainSchema,
  required: z.boolean().optional(),
  edits: z.array(editRuleSchema).optional(),
  visibleWhen: expressionSchema.optional(),
  interviewerOnly: z.boolean().optional(),
});

export const sequenceConstructSchema = z.object({
  type: z.literal('sequence'),
  id: idSchema,
  label: internationalStringSchema.optional(),
  children: z.array(controlConstructSchema),
  visibleWhen: expressionSchema.optional(),
  isPage: z.boolean().optional(),
  moduleKind: z.enum(['entry', 'main', 'exit']).optional(),
  interviewerOnly: z.boolean().optional(),
});

export const ifThenElseConstructSchema = z.object({
  type: z.literal('ifThenElse'),
  id: idSchema,
  condition: expressionSchema.min(1),
  then: z.array(controlConstructSchema),
  else: z.array(controlConstructSchema).optional(),
});

// Note: the "a loop needs countVariableRef or loopWhile" rule is enforced in `validate.ts`
// (`checkReferences`) rather than via `.refine` here, so this stays a plain ZodObject usable in
// the discriminated union above.
export const loopConstructSchema = z.object({
  type: z.literal('loop'),
  id: idSchema,
  label: internationalStringSchema.optional(),
  countVariableRef: z.string().optional(),
  loopWhile: expressionSchema.optional(),
  loopVariable: z.string().min(1),
  itemLabel: internationalStringSchema.optional(),
  children: z.array(controlConstructSchema),
  visibleWhen: expressionSchema.optional(),
});

export const computationConstructSchema = z.object({
  type: z.literal('computation'),
  id: idSchema,
  targetVariableRef: z.string().min(1),
  expression: expressionSchema.min(1),
});

export const statementConstructSchema = z.object({
  type: z.literal('statement'),
  id: idSchema,
  text: internationalStringSchema,
  visibleWhen: expressionSchema.optional(),
  interviewerOnly: z.boolean().optional(),
});

export const prefillMappingSchema = z.object({
  sampleField: z.string().min(1),
  targetVariable: z.string().min(1),
});

export const interviewerConfigSchema = z.object({
  enabled: z.boolean(),
  allowFreeNavigation: z.boolean(),
  entryModuleRef: z.string().optional(),
  exitModuleRef: z.string().optional(),
});

export const sensorDeclarationSchema = z.object({
  kind: z.enum(['geolocation', 'camera']),
  purpose: internationalStringSchema,
  retention: internationalStringSchema.optional(),
});

export const sensorConfigSchema = z.object({
  sensors: z.array(sensorDeclarationSchema),
});

export const instrumentMetadataSchema = z.object({
  title: internationalStringSchema,
  agency: z.string().optional(),
  agencyId: z
    .string()
    .regex(/^[a-zA-Z0-9-]{1,63}(\.[a-zA-Z0-9-]{1,63})*$/, 'must be a DDI agency id (dot-separated labels, e.g. io.github.p3ji)')
    .optional(),
  description: internationalStringSchema.optional(),
  created: z.string().optional(),
});

export const instrumentSchema = z
  .object({
    id: idSchema,
    version: z.string().min(1),
    ddiProfile: z.literal('ddi-lifecycle-3.3'),
    languages: z.array(languageCodeSchema).min(1),
    defaultLanguage: languageCodeSchema,
    metadata: instrumentMetadataSchema,
    concepts: z.array(conceptSchema),
    universes: z.array(universeSchema),
    categorySchemes: z.array(categorySchemeSchema),
    variables: z.array(variableSchema),
    prefillMappings: z.array(prefillMappingSchema),
    sequence: sequenceConstructSchema,
    interviewer: interviewerConfigSchema.optional(),
    sensors: sensorConfigSchema.optional(),
  })
  .refine((inst) => inst.languages.includes(inst.defaultLanguage), {
    message: 'defaultLanguage must be one of languages',
    path: ['defaultLanguage'],
  });
