/**
 * XState v5 runtime-state-machine skeleton. Iteration 1 keeps the chart deliberately small —
 * a single `active` state that records answers and language — but it owns the canonical
 * {@link RuntimeState} and is the seam where pagination, persistence and paradata emission will
 * be added in a later iteration (see `docs/phase2-state-engine.md`).
 */
import { assign, setup } from 'xstate';
import type { Instrument, LanguageCode } from '@mobilesurvey/instrument-schema';
import { seedPrefill } from './scope.js';
import type { RuntimeState } from './types.js';

export interface RuntimeMachineInput {
  instrument: Instrument;
  sample?: Record<string, unknown>;
  language?: LanguageCode;
}

export type RuntimeEvent =
  | { type: 'ANSWER'; instanceKey: string; value: unknown }
  | { type: 'SET_LANGUAGE'; language: LanguageCode }
  | { type: 'RESET' }
  | { type: 'COMPLETE' };

export interface RuntimeMachineContext {
  instrument: Instrument;
  state: RuntimeState;
}

function initialState(input: RuntimeMachineInput): RuntimeState {
  return {
    responses: seedPrefill(input.instrument, input.sample ?? {}),
    sample: input.sample ?? {},
    language: input.language ?? input.instrument.defaultLanguage,
  };
}

export const runtimeMachine = setup({
  types: {
    context: {} as RuntimeMachineContext,
    events: {} as RuntimeEvent,
    input: {} as RuntimeMachineInput,
  },
  actions: {
    applyAnswer: assign(({ context, event }) => {
      if (event.type !== 'ANSWER') return {};
      return {
        state: {
          ...context.state,
          responses: { ...context.state.responses, [event.instanceKey]: event.value },
        },
      };
    }),
    applyLanguage: assign(({ context, event }) => {
      if (event.type !== 'SET_LANGUAGE') return {};
      return { state: { ...context.state, language: event.language } };
    }),
    reset: assign(({ context }) => ({
      state: initialState({
        instrument: context.instrument,
        sample: context.state.sample,
        language: context.state.language,
      }),
    })),
  },
}).createMachine({
  id: 'runtime',
  context: ({ input }) => ({ instrument: input.instrument, state: initialState(input) }),
  initial: 'active',
  states: {
    active: {
      on: {
        ANSWER: { actions: 'applyAnswer' },
        SET_LANGUAGE: { actions: 'applyLanguage' },
        RESET: { actions: 'reset' },
        COMPLETE: { target: 'complete' },
      },
    },
    complete: {
      on: { RESET: { target: 'active', actions: 'reset' } },
    },
  },
});
