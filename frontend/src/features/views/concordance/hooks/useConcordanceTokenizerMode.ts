import { useEffect, useRef, useState } from 'react';
import type { WorkspaceNodeInfo } from '@/api';
import {
  deriveTokenizerModelsByNode,
  type TokenizerModelColumnSelection,
} from '../../common/tokenizerModelPreferences';

type ConcordanceSearchMode = 'regex' | 'tokens';

interface UseConcordanceTokenizerModeOptions {
  effectiveNodeColumnSelections: TokenizerModelColumnSelection[];
  nodeInfoCache: Record<string, WorkspaceNodeInfo>;
}

interface UseConcordanceTokenizerModeResult {
  searchMode: ConcordanceSearchMode;
  tokensModeAvailable: boolean;
  effectiveTokenizerModelsByNode: Record<string, string>;
  setSearchModeFromUser: (mode: ConcordanceSearchMode) => void;
  recordTokenizerModel: (nodeId: string, model: string) => void;
  hydrateTokenizerState: (
    nodeIds: string[],
    modelsByNode: Record<string, string>,
    mode: ConcordanceSearchMode,
  ) => void;
}

/** Owns Concordance's tokenizer-backed search-mode state and live model overrides. */
/**
 * Used by: ConcordanceFeature because token-mode availability depends on selected columns, backend-persisted tokenizer preferences, and current-tab edits that should not leak into global state.
 * Flow: merge persisted/live tokenizer models, derive whether every selected
 * column is covered, auto-select tokens mode until the user overrides it, and
 * preserve historical request state as explicit local values.
 */
export function useConcordanceTokenizerMode({
  effectiveNodeColumnSelections,
  nodeInfoCache,
}: UseConcordanceTokenizerModeOptions): UseConcordanceTokenizerModeResult {
  const [searchMode, setSearchMode] = useState<ConcordanceSearchMode>('regex');
  const [searchModeUserSet, setSearchModeUserSet] = useState(false);
  const searchModeUserSetRef = useRef(false);
  const [tokenizerModelsByNode, setTokenizerModelsByNode] = useState<Record<string, string>>({});

  const effectiveTokenizerModelsByNode = deriveTokenizerModelsByNode(
    effectiveNodeColumnSelections,
    nodeInfoCache,
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
        if (!searchModeUserSetRef.current) setSearchMode('regex');
        return;
      }
      if (searchModeUserSetRef.current) return;
      setSearchMode('tokens');
    });
  }, [tokensModeAvailable, searchModeUserSet]);

  const setSearchModeFromUser = (mode: ConcordanceSearchMode) => {
    searchModeUserSetRef.current = true;
    setSearchMode(mode);
    setSearchModeUserSet(true);
  };

  const recordTokenizerModel = (nodeId: string, model: string) => {
    const normalized = model.trim();
    setTokenizerModelsByNode((prev) => ({ ...prev, [nodeId]: normalized }));
    if (!normalized) {
      setSearchMode('regex');
    }
  };

  const hydrateTokenizerState = (
    nodeIds: string[],
    modelsByNode: Record<string, string>,
    mode: ConcordanceSearchMode,
  ) => {
    searchModeUserSetRef.current = true;
    setTokenizerModelsByNode(
      Object.fromEntries(nodeIds.map((nodeId) => [nodeId, (modelsByNode[nodeId] ?? '').trim()])),
    );
    setSearchMode(mode);
    setSearchModeUserSet(true);
  };

  return {
    searchMode,
    tokensModeAvailable,
    effectiveTokenizerModelsByNode,
    setSearchModeFromUser,
    recordTokenizerModel,
    hydrateTokenizerState,
  };
}
