import { useState } from 'react';
import type { WorkspaceNodeInfo } from '@/api';
import {
  deriveTokenizerModelsByNode,
  type TokenizerModelColumnSelection,
} from '../../common/tokenizerModelPreferences';

type ConcordanceSearchMode = 'regex' | 'tokens';

interface UseConcordanceTokenizerModeOptions {
  effectiveNodeColumnSelections: TokenizerModelColumnSelection[];
  nodeInfoById: Record<string, WorkspaceNodeInfo>;
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
 * column is covered, keep Text as the fresh default, and preserve historical
 * request state as explicit local values.
 */
export function useConcordanceTokenizerMode({
  effectiveNodeColumnSelections,
  nodeInfoById,
}: UseConcordanceTokenizerModeOptions): UseConcordanceTokenizerModeResult {
  const [searchMode, setSearchMode] = useState<ConcordanceSearchMode>('regex');
  const [tokenizerModelsByNode, setTokenizerModelsByNode] = useState<Record<string, string>>({});

  const effectiveTokenizerModelsByNode = deriveTokenizerModelsByNode(
    effectiveNodeColumnSelections,
    nodeInfoById,
    tokenizerModelsByNode,
  );

  const tokensModeAvailable =
    effectiveNodeColumnSelections.length > 0 &&
    effectiveNodeColumnSelections.every((selection) => Boolean(selection.column));

  const setSearchModeFromUser = (mode: ConcordanceSearchMode) => {
    setSearchMode(mode);
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
    setTokenizerModelsByNode(
      Object.fromEntries(nodeIds.map((nodeId) => [nodeId, (modelsByNode[nodeId] ?? '').trim()])),
    );
    setSearchMode(mode);
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
