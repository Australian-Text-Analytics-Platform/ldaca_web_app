import type { ViewType } from '@/features/views/viewIds';

interface ContextualHintRegistration {
  view: ViewType;
  ids: readonly string[];
}

export interface ContextualHintVisitState {
  activeView: ViewType | null;
  paused: boolean;
  registrations: Record<string, ContextualHintRegistration>;
  reachedByView: Partial<Record<ViewType, readonly string[]>>;
}

export type ContextualHintVisitEvent =
  | { type: 'begin-view'; view: ViewType }
  | { type: 'end-view'; view: ViewType }
  | { type: 'register'; sourceId: string; view: ViewType; ids: readonly string[] }
  | { type: 'unregister'; sourceId: string }
  | { type: 'reach'; view: ViewType; id: string }
  | { type: 'acknowledge'; view: ViewType; id: string }
  | { type: 'defer'; view: ViewType }
  | { type: 'target-missing'; view: ViewType }
  | { type: 'hints-disabled'; view: ViewType };

export const initialContextualHintVisitState: ContextualHintVisitState = {
  activeView: null,
  paused: false,
  registrations: {},
  reachedByView: {},
};

const withoutId = (ids: readonly string[], id: string) =>
  ids.filter((candidate) => candidate !== id);

/** Pure state machine for one function visit and its session-only reached milestones. */
export function contextualHintVisitReducer(
  state: ContextualHintVisitState,
  event: ContextualHintVisitEvent,
): ContextualHintVisitState {
  switch (event.type) {
    case 'begin-view':
      return { ...state, activeView: event.view, paused: false };
    case 'end-view':
      return state.activeView === event.view
        ? { ...state, activeView: null, paused: false }
        : state;
    case 'register':
      return {
        ...state,
        registrations: {
          ...state.registrations,
          [event.sourceId]: { view: event.view, ids: [...event.ids] },
        },
      };
    case 'unregister': {
      if (!(event.sourceId in state.registrations)) return state;
      const { [event.sourceId]: _removed, ...registrations } = state.registrations;
      return { ...state, registrations };
    }
    case 'reach': {
      const reached = state.reachedByView[event.view] ?? [];
      if (reached.includes(event.id)) return state;
      return {
        ...state,
        reachedByView: {
          ...state.reachedByView,
          [event.view]: [...reached, event.id],
        },
      };
    }
    case 'acknowledge':
      return {
        ...state,
        reachedByView: {
          ...state.reachedByView,
          [event.view]: withoutId(state.reachedByView[event.view] ?? [], event.id),
        },
      };
    case 'defer':
    case 'target-missing':
    case 'hints-disabled':
      return state.activeView === event.view ? { ...state, paused: true } : state;
  }
}

/** Returns reached ids in the single canonical pedagogical order for the active view. */
export function selectContextualHintCandidates(
  state: ContextualHintVisitState,
  sequences: Readonly<Partial<Record<ViewType, readonly string[]>>>,
): readonly string[] {
  if (!state.activeView || state.paused) return [];
  const reached = new Set(state.reachedByView[state.activeView] ?? []);
  for (const registration of Object.values(state.registrations)) {
    if (registration.view !== state.activeView) continue;
    for (const id of registration.ids) reached.add(id);
  }
  return (sequences[state.activeView] ?? []).filter((id) => reached.has(id));
}
