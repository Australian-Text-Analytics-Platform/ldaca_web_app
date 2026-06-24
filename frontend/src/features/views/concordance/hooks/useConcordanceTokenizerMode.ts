import { useEffect, useState } from 'react';
import type { WorkspaceNodeLike } from '../../common/nodeSelectionTypes';
import {
  deriveTokenizerModelsByNode,
  type TokenizerModelColumnSelection,
} from '../../common/tokenizerModelPreferences';

type ConcordanceSearchMode = 'regex' | 'tokens';

interface UseConcordanceTokenizerModeOptions {
  effectiveNodeColumnSelections: TokenizerModelColumnSelection[];
  panelSelectedNodes: WorkspaceNodeLike[];
}

interface UseConcordanceTokenizerModeResult {
  searchMode: ConcordanceSearchMode;
  tokensModeAvailable: boolean;
  effectiveTokenizerModelsByNode: Record<string, string>;
  setSearchModeFromUser: (mode: ConcordanceSearchMode) => void;
  recordTokenizerModel: (nodeId: string, model: string) => void;
  clearTokenizerModel: (nodeId: string) => void;
}

/** Owns Concordance's tokenizer-backed search-mode state and live model overrides. */
/**
 * Used by: ConcordanceFeature because token-mode availability depends on selected columns, backend-persisted tokenizer preferences, and current-tab edits that should not leak into global state.
 * Flow: merge persisted/live tokenizer models, derive whether every selected column is covered, auto-select tokens mode until the user overrides it, and force regex when token coverage disappears.
 */
export function useConcordanceTokenizerMode({
  effectiveNodeColumnSelections,
  panelSelectedNodes,
}: UseConcordanceTokenizerModeOptions): UseConcordanceTokenizerModeResult {
  const [searchMode, setSearchMode] = useState<ConcordanceSearchMode>('regex');
  const [searchModeUserSet, setSearchModeUserSet] = useState(false);
  const [tokenizerModelsByNode, setTokenizerModelsByNode] = useState<Record<string, string>>({});

  const effectiveTokenizerModelsByNode = deriveTokenizerModelsByNode(
    effectiveNodeColumnSelections,
    panelSelectedNodes,
    tokenizerModelsByNode,
  );

  const selectionsWithColumn = effectiveNodeColumnSelections.filter(
    (selection) => selection.column,
  );
  const tokensModeAvailable =
    selectionsWithColumn.length > 0 &&
    selectionsWithColumn.every((selection) =>
      Boolean(effectiveTokenizerModelsByNode[selection.nodeId]),
    );

  useEffect(() => {
    void Promise.resolve().then(() => {
      if (!tokensModeAvailable) {
        setSearchMode('regex');
        setSearchModeUserSet(false);
        return;
      }
      if (searchModeUserSet) return;
      setSearchMode('tokens');
    });
  }, [tokensModeAvailable, searchModeUserSet]);

  const setSearchModeFromUser = (mode: ConcordanceSearchMode) => {
    setSearchMode(mode);
    setSearchModeUserSet(true);
  };

  const recordTokenizerModel = (nodeId: string, model: string) => {
    setTokenizerModelsByNode((prev) => {
      if (model) return { ...prev, [nodeId]: model };
      const { [nodeId]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const clearTokenizerModel = (nodeId: string) => {
    setTokenizerModelsByNode((prev) => {
      const { [nodeId]: _removed, ...rest } = prev;
      return rest;
    });
  };

  return {
    searchMode,
    tokensModeAvailable,
    effectiveTokenizerModelsByNode,
    setSearchModeFromUser,
    recordTokenizerModel,
    clearTokenizerModel,
  };
}
