import { useReducer, type SetStateAction } from 'react';
import { toast } from 'sonner';

import type { DetachNodeOption } from '@/api';
import { useDetachColumnsState } from '../../common/hooks/useDetachColumnsState';
import {
  CONCORDANCE_COLUMN_KEYS,
  CONCORDANCE_CORE_COLUMNS,
  CONCORDANCE_FREQ_COLUMNS,
} from '../../common/generatedColumns';
import {
  concordanceDetachDialogReducer,
  createConcordanceDetachDialogState,
  type ConcordanceDetachTarget,
} from './concordanceDetachDialogState';

export type { ConcordanceDetachTarget } from './concordanceDetachDialogState';

type PerHitDetachHandler = (
  nodeId: string,
  column: string,
  nodeLabel: string,
  selectedColumns: string[],
) => Promise<void> | void;

type DispersionDetachHandler = (
  nodeId: string,
  column: string,
  options: {
    nodeLabel: string;
    selectedBins: ReadonlySet<number> | null;
    binCount: number;
    selectedColumns: string[];
    selectedMatchedTexts: string[] | null;
    matchCaseInsensitive: boolean;
  },
) => Promise<void> | void;

interface OpenDispersionOptions {
  selectedMatchedTexts?: string[] | null;
  matchCaseInsensitive?: boolean;
}

interface UseConcordanceDetachDialogsArgs {
  workspaceId: string | null;
  handleDetach: PerHitDetachHandler;
  handleDispersionDetach: DispersionDetachHandler;
  nodeDetaching: Record<string, boolean>;
}

const CONC_DEFAULT_DETACH_COLS = new Set<string>([
  ...CONCORDANCE_CORE_COLUMNS,
  ...CONCORDANCE_FREQ_COLUMNS,
  CONCORDANCE_COLUMN_KEYS.extraction,
]);

/** Builds detach choices from the source selection without a second API contract. */
const buildDetachNodeOptions = (nodes: ConcordanceDetachTarget[]): DetachNodeOption[] =>
  nodes.map((node) => ({
    node_id: node.nodeId,
    node_name: node.nodeLabel,
    text_column: node.column,
    available_columns: [...new Set([node.column, ...CONC_DEFAULT_DETACH_COLS])],
    disabled_columns: [],
  }));

/** Builds the per-hit dialog's generated-column defaults. */
/**
 * Called by: useConcordanceDetachDialogs after loading per-hit options because the feature wants concordance output columns selected automatically while source metadata remains opt-in.
 */
const selectDefaultConcordanceColumns = (options: DetachNodeOption[]): Record<string, string[]> => {
  const initial: Record<string, string[]> = {};
  options.forEach((node) => {
    initial[node.node_id] = node.available_columns.filter((column) =>
      CONC_DEFAULT_DETACH_COLS.has(column),
    );
  });
  return initial;
};

/** Adapts per-hit detach options to the columns that make sense for dispersion output. */
/**
 * Called by: useConcordanceDetachDialogs after loading dispersion options because the aggregated worker always emits its generated columns and only source columns should be user-selectable.
 */
const toDispersionDetachOptions = (options: DetachNodeOption[]): DetachNodeOption[] => {
  const dispersionHiddenColumns = new Set<string>([CONCORDANCE_COLUMN_KEYS.extraction]);
  return options.map((node) => {
    const disabled = new Set(node.disabled_columns ?? []);
    return {
      ...node,
      available_columns: node.available_columns.filter(
        (column) => !disabled.has(column) && !dispersionHiddenColumns.has(column),
      ),
      disabled_columns: [],
    };
  });
};

/** Creates an empty per-node selection record for a freshly opened dispersion dialog. */
/**
 * Called by: useConcordanceDetachDialogs when opening the dispersion dialog because dispersion columns start as explicit opt-ins rather than generated defaults.
 */
const emptySelectionForOptions = (options: DetachNodeOption[]): Record<string, string[]> => {
  const initial: Record<string, string[]> = {};
  options.forEach((node) => {
    initial[node.node_id] = [];
  });
  return initial;
};

const resolveBooleanAction = (value: SetStateAction<boolean>, current: boolean): boolean =>
  typeof value === 'function' ? value(current) : value;

/**
 * Owns both concordance detach dialogs so ConcordanceFeature does not carry two
 * parallel pending-node/option/column-selection state machines inline.
 * Used by: ConcordanceFeature because the results panel needs simple open
 * callbacks and dialog props while the detach workflow still needs access to
 * task handlers and node detaching state.
 * Flow: open a dialog by fetching options and seeding selections, confirm by
 * dispatching the matching task-flow handler for every pending node, then reset
 * that dialog's transient state.
 */
export function useConcordanceDetachDialogs({
  workspaceId,
  handleDetach,
  handleDispersionDetach,
  nodeDetaching,
}: UseConcordanceDetachDialogsArgs) {
  const [dialogState, dispatchDialog] = useReducer(
    concordanceDetachDialogReducer,
    undefined,
    createConcordanceDetachDialogState,
  );
  const { perHit: perHitDialog, dispersion: dispersionDialog } = dialogState;

  const {
    selectedDetachColumns,
    setSelectedDetachColumns,
    toggleDetachColumn,
    selectAllDetachColumns,
    deselectAllDetachColumns,
  } = useDetachColumnsState(perHitDialog.options);

  const {
    selectedDetachColumns: selectedDispersionColumns,
    setSelectedDetachColumns: setSelectedDispersionColumns,
    toggleDetachColumn: toggleDispersionColumn,
    selectAllDetachColumns: selectAllDispersionColumns,
    deselectAllDetachColumns: deselectAllDispersionColumns,
  } = useDetachColumnsState(dispersionDialog.options);

  const resetPerHitDialog = () => {
    dispatchDialog({ type: 'perHitReset' });
    setSelectedDetachColumns({});
  };

  const resetDispersionDialog = () => {
    dispatchDialog({ type: 'dispersionReset' });
    setSelectedDispersionColumns({});
  };

  /** Opens the per-hit detach dialog after loading selectable source columns. */
  /**
   * Called by: ConcordanceResultsPanel via ConcordanceFeature because users can add per-hit concordance output back into the workspace from each result block.
   * Flow: cache pending nodes, fetch column options, select generated CONC_* defaults, then show the dialog or reset on failure.
   */
  const openDetachDialog = (nodes: ConcordanceDetachTarget[]) => {
    dispatchDialog({ type: 'perHitRequested', nodes });

    try {
      if (!workspaceId) throw new Error('No workspace selected');
      const options = buildDetachNodeOptions(nodes);
      setSelectedDetachColumns(selectDefaultConcordanceColumns(options));
      dispatchDialog({ type: 'perHitOpened', options });
    } catch (error) {
      console.error('Failed to load concordance detach options:', error);
      toast.error(
        `Failed to load concordance detach options: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      resetPerHitDialog();
    }
  };

  /** Confirms per-hit detach using the explicitly selected output columns. */
  /**
   * Called by: ConcordanceFeature's table-results DetachColumnsDialog because the confirm button must dispatch one workspace detach request per pending source node.
   */
  const handleDetachConfirm = async () => {
    for (const node of perHitDialog.pendingNodes) {
      const columns = selectedDetachColumns[node.nodeId] ?? [];
      await handleDetach(node.nodeId, node.column, node.nodeLabel, columns);
    }
    resetPerHitDialog();
  };

  /** Opens the aggregated dispersion detach dialog with optional bin and legend filters. */
  /**
   * Called by: ConcordanceResultsPanel via ConcordanceFeature because dispersion charts can add per-document aggregate rows back into the workspace.
   * Flow: cache pending nodes and filters, load source-column options, remove columns emitted by the worker automatically, then open the dialog or reset on failure.
   */
  const openDispersionDetachDialog = (
    nodes: ConcordanceDetachTarget[],
    selectedBins: ReadonlySet<number> | null,
    binCount: number,
    options?: OpenDispersionOptions,
  ) => {
    dispatchDialog({
      type: 'dispersionRequested',
      nodes,
      selectedBins: selectedBins && selectedBins.size > 0 ? Array.from(selectedBins) : null,
      binCount,
      matchedTexts: options?.selectedMatchedTexts ?? null,
      caseInsensitive: !!options?.matchCaseInsensitive,
    });

    try {
      if (!workspaceId) throw new Error('No workspace selected');
      const loadedOptions = buildDetachNodeOptions(nodes);
      const dispersionOptions = toDispersionDetachOptions(loadedOptions);
      setSelectedDispersionColumns(emptySelectionForOptions(dispersionOptions));
      dispatchDialog({ type: 'dispersionOpened', options: dispersionOptions });
    } catch (error) {
      console.error('Failed to load dispersion detach options:', error);
      toast.error(
        `Failed to load dispersion detach options: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      resetDispersionDialog();
    }
  };

  /** Confirms aggregated dispersion detach with the cached bin and legend filters. */
  /**
   * Called by: ConcordanceFeature's dispersion DetachColumnsDialog because the confirm button must dispatch one aggregated detach request per pending source node.
   * Flow: restore the selected-bin Set expected by the task-flow handler, pass selected columns and filters for each node, then reset dialog state.
   */
  const handleDispersionDetachConfirm = async () => {
    const selectedBins = dispersionDialog.selectedBins
      ? new Set(dispersionDialog.selectedBins)
      : null;
    for (const node of dispersionDialog.pendingNodes) {
      const columns = selectedDispersionColumns[node.nodeId] ?? [];
      await handleDispersionDetach(node.nodeId, node.column, {
        nodeLabel: node.nodeLabel,
        selectedBins,
        binCount: dispersionDialog.binCount,
        selectedColumns: columns,
        selectedMatchedTexts: dispersionDialog.matchedTexts,
        matchCaseInsensitive: dispersionDialog.caseInsensitive,
      });
    }
    resetDispersionDialog();
  };

  const anyNodeDetaching = perHitDialog.pendingNodes.some((node) =>
    Boolean(nodeDetaching[node.nodeId]),
  );
  const anyDispersionNodeDetaching = dispersionDialog.pendingNodes.some((node) =>
    Boolean(nodeDetaching[node.nodeId]),
  );

  return {
    openDetachDialog,
    openDispersionDetachDialog,
    detachDialog: {
      open: perHitDialog.open,
      onOpenChange: (value: SetStateAction<boolean>) => {
        if (!resolveBooleanAction(value, perHitDialog.open)) resetPerHitDialog();
      },
      isDetaching: anyNodeDetaching,
      detachNodeOptions: perHitDialog.options,
      selectedDetachColumns,
      toggleDetachColumn,
      selectAllDetachColumns,
      deselectAllDetachColumns,
      handleDetachConfirm,
    },
    dispersionDetachDialog: {
      open: dispersionDialog.open,
      onOpenChange: (value: SetStateAction<boolean>) => {
        if (!resolveBooleanAction(value, dispersionDialog.open)) resetDispersionDialog();
      },
      isDetaching: anyDispersionNodeDetaching,
      detachNodeOptions: dispersionDialog.options,
      selectedDetachColumns: selectedDispersionColumns,
      toggleDetachColumn: toggleDispersionColumn,
      selectAllDetachColumns: selectAllDispersionColumns,
      deselectAllDetachColumns: deselectAllDispersionColumns,
      handleDetachConfirm: handleDispersionDetachConfirm,
    },
  };
}
