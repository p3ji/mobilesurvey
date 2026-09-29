/**
 * Shared test instrument for the validation-engine suite: one variable of each scalar
 * representation, a grid, a markAll, and a small establishment `table` (with a total row/col
 * and one disabled cell) so every check module has real fixtures to exercise against, plus a
 * hard edit and a soft edit that reference the table's synthetic totals.
 */
import type { Instrument, InternationalString } from '@mobilesurvey/instrument-schema';

const s = (en: string): InternationalString => ({ en });

export const fixtureInstrument: Instrument = {
  id: 'urn:ddi:test:validation-engine:1.0',
  version: '1.0.0',
  ddiProfile: 'ddi-lifecycle-3.3',
  languages: ['en'],
  defaultLanguage: 'en',
  metadata: { title: s('Validation engine fixture') },
  concepts: [],
  universes: [],
  categorySchemes: [
    {
      id: 'cs.status',
      label: s('Status'),
      categories: [
        { code: 'active', label: s('Active') },
        { code: 'inactive', label: s('Inactive') },
      ],
    },
    {
      id: 'cs.gridRows',
      label: s('Grid rows'),
      categories: [
        { code: 'r1', label: s('Row 1') },
        { code: 'r2', label: s('Row 2') },
        { code: 'r3', label: s('Row 3') },
      ],
    },
    {
      id: 'cs.gridCols',
      label: s('Grid cols'),
      categories: [
        { code: 'lo', label: s('Low') },
        { code: 'hi', label: s('High') },
      ],
    },
    {
      id: 'cs.opts',
      label: s('Options'),
      categories: [
        { code: 'a', label: s('A') },
        { code: 'b', label: s('B') },
      ],
    },
    {
      id: 'cs.tableRows',
      label: s('Table rows'),
      categories: [
        { code: 'row1', label: s('Row 1') },
        { code: 'row2', label: s('Row 2') },
      ],
    },
    {
      id: 'cs.tableCols',
      label: s('Table cols'),
      categories: [
        { code: 'col1', label: s('Col 1') },
        { code: 'col2', label: s('Col 2') },
      ],
    },
  ],
  variables: [
    { id: 'v.revenue', name: 'revenue', kind: 'collected', label: s('Revenue'), representation: 'numeric' },
    { id: 'v.status', name: 'status', kind: 'collected', label: s('Status'), representation: 'code', categorySchemeRef: 'cs.status' },
    { id: 'v.notes', name: 'notes', kind: 'collected', label: s('Notes'), representation: 'text' },
    { id: 'v.contact', name: 'contact', kind: 'collected', label: s('Contact name'), representation: 'text', isPII: true },
    { id: 'v.gridAnchor', name: 'gridAnchor', kind: 'hidden', label: s('Grid anchor'), representation: 'text' },
    { id: 'v.markAnchor', name: 'markAnchor', kind: 'hidden', label: s('MarkAll anchor'), representation: 'text' },
    { id: 'v.tableAnchor', name: 'tableAnchor', kind: 'hidden', label: s('Table anchor'), representation: 'text' },
    { id: 'v.budget', name: 'budget', kind: 'collected', label: s('Budget'), representation: 'numeric' },
  ],
  prefillMappings: [],
  sequence: {
    type: 'sequence',
    id: 'seq.root',
    children: [
      {
        type: 'question',
        id: 'q.revenue',
        variableRef: 'revenue',
        text: s('Revenue'),
        required: true,
        responseDomain: { type: 'numeric', min: 0, max: 100000, decimals: 0 },
      },
      {
        type: 'question',
        id: 'q.status',
        variableRef: 'status',
        text: s('Status'),
        responseDomain: { type: 'code', categorySchemeRef: 'cs.status', selection: 'single' },
      },
      {
        type: 'question',
        id: 'q.notes',
        variableRef: 'notes',
        text: s('Notes'),
        responseDomain: { type: 'text' },
      },
      {
        type: 'question',
        id: 'q.contact',
        variableRef: 'contact',
        text: s('Contact name'),
        responseDomain: { type: 'text' },
      },
      {
        type: 'question',
        id: 'q.grid',
        variableRef: 'gridAnchor',
        text: s('Grid question'),
        responseDomain: { type: 'grid', rowSchemeRef: 'cs.gridRows', colSchemeRef: 'cs.gridCols', variablePrefix: 'G' },
      },
      {
        type: 'question',
        id: 'q.mark',
        variableRef: 'markAnchor',
        text: s('MarkAll question'),
        responseDomain: { type: 'markAll', categorySchemeRef: 'cs.opts', variablePrefix: 'M' },
      },
      {
        type: 'question',
        id: 'q.table',
        variableRef: 'tableAnchor',
        text: s('Table question'),
        responseDomain: {
          type: 'table',
          rowSchemeRef: 'cs.tableRows',
          colSchemeRef: 'cs.tableCols',
          variablePrefix: 'T',
          min: 0,
          max: 1000,
          totalRow: true,
          totalCol: true,
          disabledCells: ['row1:col2'],
        },
      },
      {
        type: 'question',
        id: 'q.budget',
        variableRef: 'budget',
        text: s('Budget'),
        responseDomain: { type: 'numeric', min: 0 },
        edits: [
          {
            id: 'edit.budget.balance',
            type: 'hard',
            when: 'isAnswered($T_TOT_TOT) && $budget != $T_TOT_TOT',
            message: s('Budget must equal the table grand total.'),
          },
          {
            id: 'edit.budget.large',
            type: 'soft',
            when: '$budget > 900',
            message: s('Budget is unusually large.'),
          },
        ],
      },
    ],
  },
};
