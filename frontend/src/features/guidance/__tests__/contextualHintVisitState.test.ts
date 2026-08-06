import { describe, expect, it } from 'vitest';

import {
  contextualHintVisitReducer,
  initialContextualHintVisitState,
  selectContextualHintCandidates,
} from '../contextualHintVisitState';

const sequences = {
  filter: ['input', 'parameters', 'preview', 'outcome'],
  concordance: ['concordance-input'],
} as const;

describe('contextualHintVisitState', () => {
  it('orders registered and event milestones by the canonical sequence', () => {
    let state = contextualHintVisitReducer(initialContextualHintVisitState, {
      type: 'register',
      sourceId: 'tab-a',
      view: 'filter',
      ids: ['preview', 'input'],
    });
    state = contextualHintVisitReducer(state, { type: 'reach', view: 'filter', id: 'outcome' });
    state = contextualHintVisitReducer(state, { type: 'begin-view', view: 'filter' });

    expect(selectContextualHintCandidates(state, sequences)).toEqual([
      'input',
      'preview',
      'outcome',
    ]);
  });

  it('pauses until a different view is entered and the original view is revisited', () => {
    let state = contextualHintVisitReducer(initialContextualHintVisitState, {
      type: 'register',
      sourceId: 'tab-a',
      view: 'filter',
      ids: ['input'],
    });
    state = contextualHintVisitReducer(state, { type: 'begin-view', view: 'filter' });
    state = contextualHintVisitReducer(state, { type: 'defer', view: 'filter' });
    expect(selectContextualHintCandidates(state, sequences)).toEqual([]);

    state = contextualHintVisitReducer(state, { type: 'end-view', view: 'filter' });
    state = contextualHintVisitReducer(state, { type: 'begin-view', view: 'concordance' });
    state = contextualHintVisitReducer(state, { type: 'end-view', view: 'concordance' });
    state = contextualHintVisitReducer(state, { type: 'begin-view', view: 'filter' });
    expect(selectContextualHintCandidates(state, sequences)).toEqual(['input']);
  });

  it('retains event milestones across visits until acknowledgment', () => {
    let state = contextualHintVisitReducer(initialContextualHintVisitState, {
      type: 'reach',
      view: 'filter',
      id: 'outcome',
    });
    state = contextualHintVisitReducer(state, { type: 'begin-view', view: 'filter' });
    expect(selectContextualHintCandidates(state, sequences)).toEqual(['outcome']);

    state = contextualHintVisitReducer(state, {
      type: 'acknowledge',
      view: 'filter',
      id: 'outcome',
    });
    expect(selectContextualHintCandidates(state, sequences)).toEqual([]);
  });

  it('does not let an Analysis Tab registration reset the function visit', () => {
    let state = contextualHintVisitReducer(initialContextualHintVisitState, {
      type: 'begin-view',
      view: 'filter',
    });
    state = contextualHintVisitReducer(state, { type: 'defer', view: 'filter' });
    state = contextualHintVisitReducer(state, {
      type: 'register',
      sourceId: 'tab-b',
      view: 'filter',
      ids: ['input'],
    });
    expect(state.paused).toBe(true);
    expect(selectContextualHintCandidates(state, sequences)).toEqual([]);
  });

  it.each(['target-missing', 'hints-disabled'] as const)(
    'pauses the current visit for %s without removing the event backlog',
    (type) => {
      let state = contextualHintVisitReducer(initialContextualHintVisitState, {
        type: 'reach',
        view: 'filter',
        id: 'outcome',
      });
      state = contextualHintVisitReducer(state, { type: 'begin-view', view: 'filter' });
      state = contextualHintVisitReducer(state, { type, view: 'filter' });

      expect(state.paused).toBe(true);
      expect(state.reachedByView.filter).toEqual(['outcome']);
    },
  );
});
