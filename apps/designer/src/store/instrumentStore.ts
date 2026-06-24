/**
 * Designer document store: holds the instrument-under-edit, the current selection and language,
 * and an undo/redo history. Mutations go through `update(recipe)`, which applies an Immer
 * producer and snapshots the previous instrument (cheap thanks to structural sharing).
 */
import { produce } from 'immer';
import { create } from 'zustand';
import { lfsInstrument, type Instrument, type LanguageCode } from '@mobilesurvey/instrument-schema';

const HISTORY_LIMIT = 50;

export interface DesignerStore {
  instrument: Instrument;
  /** Selected construct id, variable id, or null. */
  selectedId: string | null;
  language: LanguageCode;
  past: Instrument[];
  future: Instrument[];

  select(id: string | null): void;
  setLanguage(language: LanguageCode): void;
  /** Apply an Immer recipe to the instrument and record history. */
  update(recipe: (draft: Instrument) => void): void;
  /** Replace the whole instrument (e.g. on JSON import), recording history. */
  load(instrument: Instrument): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

export const useDesigner = create<DesignerStore>((set, get) => ({
  instrument: lfsInstrument,
  selectedId: lfsInstrument.sequence.id,
  language: lfsInstrument.defaultLanguage,
  past: [],
  future: [],

  select: (id) => set({ selectedId: id }),
  setLanguage: (language) => set({ language }),

  update: (recipe) =>
    set((s) => ({
      instrument: produce(s.instrument, recipe),
      past: [...s.past, s.instrument].slice(-HISTORY_LIMIT),
      future: [],
    })),

  load: (instrument) =>
    set((s) => ({
      instrument,
      selectedId: instrument.sequence.id,
      past: [...s.past, s.instrument].slice(-HISTORY_LIMIT),
      future: [],
      language: instrument.languages.includes(s.language) ? s.language : instrument.defaultLanguage,
    })),

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return s;
      const previous = s.past[s.past.length - 1]!;
      return {
        instrument: previous,
        past: s.past.slice(0, -1),
        future: [s.instrument, ...s.future],
      };
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0) return s;
      const next = s.future[0]!;
      return {
        instrument: next,
        past: [...s.past, s.instrument],
        future: s.future.slice(1),
      };
    }),

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));
