import type { DetachDialogNodeOption } from '../../common/components/DetachColumnsDialog';

export interface ConcordanceDetachTarget {
  nodeId: string;
  column: string;
  nodeLabel: string;
}

interface PerHitDetachDialogState {
  open: boolean;
  pendingNodes: ConcordanceDetachTarget[];
  options: DetachDialogNodeOption[];
}

interface DispersionDetachDialogState {
  open: boolean;
  pendingNodes: ConcordanceDetachTarget[];
  options: DetachDialogNodeOption[];
  selectedBins: number[] | null;
  binCount: number;
  matchedTexts: string[] | null;
  caseInsensitive: boolean;
}

export interface ConcordanceDetachDialogState {
  perHit: PerHitDetachDialogState;
  dispersion: DispersionDetachDialogState;
}

export type ConcordanceDetachDialogAction =
  | { type: 'perHitRequested'; nodes: ConcordanceDetachTarget[] }
  | { type: 'perHitOpened'; options: DetachDialogNodeOption[] }
  | { type: 'perHitReset' }
  | {
      type: 'dispersionRequested';
      nodes: ConcordanceDetachTarget[];
      selectedBins: number[] | null;
      binCount: number;
      matchedTexts: string[] | null;
      caseInsensitive: boolean;
    }
  | { type: 'dispersionOpened'; options: DetachDialogNodeOption[] }
  | { type: 'dispersionReset' };

const emptyPerHitState: PerHitDetachDialogState = {
  open: false,
  pendingNodes: [],
  options: [],
};

const emptyDispersionState: DispersionDetachDialogState = {
  open: false,
  pendingNodes: [],
  options: [],
  selectedBins: null,
  binCount: 0,
  matchedTexts: null,
  caseInsensitive: false,
};

/**
 * Creates reducer-owned payload state for the concordance detach dialogs.
 * Used by: useConcordanceDetachDialogs hook.
 * Why: because each dialog's open flag, pending nodes, loaded options, and
 * dispersion filters form one payload that should reset atomically.
 */
export const createConcordanceDetachDialogState = (): ConcordanceDetachDialogState => ({
  perHit: emptyPerHitState,
  dispersion: emptyDispersionState,
});

/**
 * Reduces per-hit and dispersion detach dialog payload state.
 * Used by: useConcordanceDetachDialogs and reducer tests.
 * Flow: request actions cache the pending targets/filters, opened actions attach
 * loaded source-column options, and reset actions clear hidden stale payloads.
 */
export const concordanceDetachDialogReducer = (
  state: ConcordanceDetachDialogState,
  action: ConcordanceDetachDialogAction,
): ConcordanceDetachDialogState => {
  switch (action.type) {
    case 'perHitRequested':
      return {
        ...state,
        perHit: { ...emptyPerHitState, pendingNodes: action.nodes },
      };
    case 'perHitOpened':
      return {
        ...state,
        perHit: { ...state.perHit, open: true, options: action.options },
      };
    case 'perHitReset':
      return state.perHit.open || state.perHit.pendingNodes.length || state.perHit.options.length
        ? { ...state, perHit: emptyPerHitState }
        : state;
    case 'dispersionRequested':
      return {
        ...state,
        dispersion: {
          ...emptyDispersionState,
          pendingNodes: action.nodes,
          selectedBins: action.selectedBins,
          binCount: action.binCount,
          matchedTexts: action.matchedTexts,
          caseInsensitive: action.caseInsensitive,
        },
      };
    case 'dispersionOpened':
      return {
        ...state,
        dispersion: { ...state.dispersion, open: true, options: action.options },
      };
    case 'dispersionReset':
      return state.dispersion.open ||
        state.dispersion.pendingNodes.length ||
        state.dispersion.options.length
        ? { ...state, dispersion: emptyDispersionState }
        : state;
    default:
      return state;
  }
};
