import { Calculator, Code2, Filter, Layers, Merge, Search, Shuffle } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import InfoIcon from '@/components/help/InfoIcon';
import { type EditorTabItem, EditorTabs } from '@/components/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { useGuidance } from '@/features/guidance/GuidanceContext';
import { CONTEXTUAL_HINT_IDS } from '@/features/guidance/registry';
import { useProgressiveContextualHints } from '@/features/guidance/useProgressiveContextualHints';
import { NodeInputsPanel } from '@/features/views/common/components/NodeInputsPanel';
import type { NodeSelectionRenderArgs } from '@/features/views/common/components/NodeSelectionList';
import { useWorkspaceNodeInputs } from '@/features/views/common/nodeInputs';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceStatus } from '@/features/workspace/common/hooks/useWorkspaceStatus';
import { isArrowStringField } from '@/lib/arrow/arrowTable';
import { useAuthStore } from '@/stores/authStore';
import {
  preprocessingInputsKey,
  usePreprocessingInputsStore,
} from '@/stores/preprocessingInputsStore';
import { AggregateSubTab } from './aggregate/AggregateSubTab';
import { ConcatSubTab } from './concat/ConcatSubTab';
import { FilterSubTab } from './filter/FilterSubTab';
import { JoinSubTab } from './join/JoinSubTab';
import { CREATE_DATA_BLOCK_MODE, type PreprocessingApplyMode } from './preprocessingApplyMode';
import { ReplaceSubTab } from './replace/ReplaceSubTab';
import { SliceSubTab } from './slice/SliceSubTab';
import { MAX_CONCAT_NODES, MAX_JOIN_NODES } from './types';

type DataPrepSubtab = 'filter' | 'slice' | 'join' | 'concat' | 'find' | 'aggregate' | 'expression';

const PREPROCESSING_TABS: EditorTabItem[] = [
  {
    id: 'filter',
    title: 'Filter',
    icon: <Filter className="size-4" />,
    tabDomId: 'preprocessing-tab-filter',
    panelDomId: 'preprocessing-panel-filter',
    'data-guidance': 'preprocessing-operation-filter',
  },
  {
    id: 'slice',
    title: 'Sample',
    icon: <Shuffle className="size-4" />,
    tabDomId: 'preprocessing-tab-slice',
    panelDomId: 'preprocessing-panel-slice',
    'data-guidance': 'preprocessing-operation-sample',
  },
  {
    id: 'join',
    title: 'Join',
    icon: <Merge className="size-4" />,
    tabDomId: 'preprocessing-tab-join',
    panelDomId: 'preprocessing-panel-join',
    'data-guidance': 'preprocessing-operation-join',
  },
  {
    id: 'concat',
    title: 'Stack',
    icon: <Layers className="size-4" />,
    tabDomId: 'preprocessing-tab-concat',
    panelDomId: 'preprocessing-panel-concat',
    'data-guidance': 'preprocessing-operation-stack',
  },
  {
    id: 'find',
    title: 'Find',
    icon: <Search className="size-4" />,
    tabDomId: 'preprocessing-tab-find',
    panelDomId: 'preprocessing-panel-find',
    'data-guidance': 'preprocessing-operation-find',
  },
  {
    id: 'aggregate',
    title: 'Create',
    icon: <Calculator className="size-4" />,
    tabDomId: 'preprocessing-tab-aggregate',
    panelDomId: 'preprocessing-panel-aggregate',
    'data-guidance': 'preprocessing-operation-create',
  },
  {
    id: 'expression',
    title: 'Expression',
    icon: <Code2 className="size-4" />,
    tabDomId: 'preprocessing-tab-expression',
    panelDomId: 'preprocessing-panel-expression',
    'data-guidance': 'preprocessing-operation-expression',
  },
];

const EMPTY_PREPROCESSING_INPUTS: [] = [];

const TypedExpressionSubTab = lazy(() =>
  import('./expression/TypedExpressionSubTab').then((module) => ({
    default: module.TypedExpressionSubTab,
  })),
);

/** Shown only while the CodeMirror-backed expression subtab chunk is loading. */
const PolarsExpressionFallback = () => (
  <div className="rounded-md border border-surface-border/60 bg-panel/30 px-3 py-2 text-body text-description">
    Loading expression editor...
  </div>
);

// Hosts preprocessing subtabs and passes the active input node context into each tool.
/**
 * Rendered by: the analysis feature registry when this panel is selected.
 * Flow: read workspace/auth state, derive inputs and analysis parameters,
 * render the active preprocessing subtab, and lazy-load the CodeMirror-backed
 * expression editor only when users open that subtab.
 */
function DataPreprocessingFeature() {
  const { reachContextualHint } = useGuidance();
  const { currentWorkspaceId } = useWorkspaceData();
  const userId = useAuthStore((state) => state.session?.user?.id ?? '__anonymous__');
  const {
    filterNode,
    filterPreview,
    joinNodes,
    concatNodes,
    concatPreview,
    sliceNode,
    slicePreview,
    replaceText,
    replaceTextPreview,
    refreshNodeSchema,
    polarsExpressionPreview,
    polarsExpressionApply,
  } = useWorkspaceActions();
  const { isLoading } = useWorkspaceStatus();

  const [activeSubtab, setActiveSubtab] = useState<DataPrepSubtab>('filter');
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');

  const preprocessingInputKey = preprocessingInputsKey(userId, currentWorkspaceId, activeSubtab);
  const persistedInputs = usePreprocessingInputsStore(
    (state) => state.byKey[preprocessingInputKey] ?? EMPTY_PREPROCESSING_INPUTS,
  );
  const setPersistedInputs = usePreprocessingInputsStore((state) => state.setInputs);
  const maxInputNodes =
    activeSubtab === 'join' ? MAX_JOIN_NODES : activeSubtab === 'concat' ? MAX_CONCAT_NODES : 1;
  const nodeInputs = useWorkspaceNodeInputs({
    value: persistedInputs,
    onChange: (inputs) => {
      if (!currentWorkspaceId) return;
      setPersistedInputs(userId, currentWorkspaceId, activeSubtab, inputs);
    },
    constraints: {
      maxNodes: maxInputNodes,
      ...(activeSubtab === 'find' ? { fieldPredicate: isArrowStringField } : {}),
    },
  });
  const selectedNodes = nodeInputs.selectedNodes;
  const workspaceNodes = [...selectedNodes, ...nodeInputs.availableNodes];
  const selectedNode = selectedNodes[0] ?? null;
  const selectedNodeIds = nodeInputs.resolvedNodes.map((node) => node.id);
  const selectedNodeId = selectedNodeIds[0] ?? null;
  const selectedNodeColumnOptions = nodeInputs.resolvedNodes[0]?.columnOptions ?? [];
  const selectedNodeColumns = Object.fromEntries(
    nodeInputs.resolvedNodes.map((node) => [node.id, node.column]),
  );
  const applyModeScope = `${activeSubtab}:${selectedNodeId ?? ''}`;
  const [applyModeState, setApplyModeState] = useState<{
    scope: string;
    value: PreprocessingApplyMode;
  }>({
    scope: applyModeScope,
    value: CREATE_DATA_BLOCK_MODE,
  });
  const applyMode =
    applyModeState.scope === applyModeScope ? applyModeState.value : CREATE_DATA_BLOCK_MODE;
  const setApplyMode = (value: PreprocessingApplyMode) => {
    setApplyModeState({ scope: applyModeScope, value });
  };
  const setSelectedJoinColumns = (columns: Record<string, string>) => {
    if (!currentWorkspaceId) return;
    setPersistedInputs(
      userId,
      currentWorkspaceId,
      'join',
      persistedInputs.map((input) => {
        const column = columns[input.node_id];
        return column === undefined ? input : { ...input, column };
      }),
    );
  };
  const showInputColumnPicker = activeSubtab === 'find' || activeSubtab === 'join';
  const preprocessingColumnLabel = ({ nodeId }: NodeSelectionRenderArgs) => {
    if (activeSubtab === 'join') {
      if (nodeId === selectedNodeIds[0]) return 'Left column:';
      if (nodeId === selectedNodeIds[1]) return 'Right column:';
      return 'Join column:';
    }
    return 'Text column:';
  };

  // Gives child subtabs one shared alert surface for validation and backend errors.
  /**
   * Passed to preprocessing sub-tabs as the shared alert callback.
   */
  const handleAlert = (message: string) => {
    setAlertMessage(message);
    setAlertOpen(true);
  };

  const reachApplyOutcome = (mode: PreprocessingApplyMode) => {
    reachContextualHint(
      mode === CREATE_DATA_BLOCK_MODE
        ? CONTEXTUAL_HINT_IDS.preprocessing.createOutcome
        : CONTEXTUAL_HINT_IDS.preprocessing.updateOutcome,
    );
  };
  const guidedFilterPreview = async (...args: Parameters<typeof filterPreview>) => {
    const response = await filterPreview(...args);
    reachContextualHint(CONTEXTUAL_HINT_IDS.preprocessing.preview);
    return response;
  };
  const guidedFilterNode = async (...args: Parameters<typeof filterNode>) => {
    const response = await filterNode(...args);
    reachApplyOutcome(args[2] ?? CREATE_DATA_BLOCK_MODE);
    return response;
  };
  const guidedSlicePreview = async (...args: Parameters<typeof slicePreview>) => {
    const response = await slicePreview(...args);
    reachContextualHint(CONTEXTUAL_HINT_IDS.preprocessing.preview);
    return response;
  };
  const guidedSliceNode = async (...args: Parameters<typeof sliceNode>) => {
    const response = await sliceNode(...args);
    reachApplyOutcome(CREATE_DATA_BLOCK_MODE);
    return response;
  };
  const guidedJoinNodes = async (...args: Parameters<typeof joinNodes>) => {
    const response = await joinNodes(...args);
    reachApplyOutcome(CREATE_DATA_BLOCK_MODE);
    return response;
  };
  const guidedConcatPreview = async (...args: Parameters<typeof concatPreview>) => {
    const response = await concatPreview(...args);
    reachContextualHint(CONTEXTUAL_HINT_IDS.preprocessing.preview);
    return response;
  };
  const guidedConcatNodes = async (...args: Parameters<typeof concatNodes>) => {
    const response = await concatNodes(...args);
    reachApplyOutcome(CREATE_DATA_BLOCK_MODE);
    return response;
  };
  const guidedReplaceTextPreview = async (...args: Parameters<typeof replaceTextPreview>) => {
    const response = await replaceTextPreview(...args);
    reachContextualHint(CONTEXTUAL_HINT_IDS.preprocessing.preview);
    return response;
  };
  const guidedReplaceText = async (...args: Parameters<typeof replaceText>) => {
    const response = await replaceText(...args);
    reachApplyOutcome(args[2] ?? CREATE_DATA_BLOCK_MODE);
    return response;
  };
  const guidedExpressionPreview = async (...args: Parameters<typeof polarsExpressionPreview>) => {
    const response = await polarsExpressionPreview(...args);
    reachContextualHint(CONTEXTUAL_HINT_IDS.preprocessing.preview);
    return response;
  };
  const guidedExpressionApply = async (...args: Parameters<typeof polarsExpressionApply>) => {
    const response = await polarsExpressionApply(...args);
    reachApplyOutcome(args[2] ?? CREATE_DATA_BLOCK_MODE);
    return response;
  };

  const operationReady =
    activeSubtab === 'join'
      ? selectedNodeIds.length >= 2
      : activeSubtab === 'concat'
        ? selectedNodeIds.length >= 2
        : Boolean(selectedNodeId);
  const activeOperationHint = {
    filter: CONTEXTUAL_HINT_IDS.preprocessing.filter,
    slice: CONTEXTUAL_HINT_IDS.preprocessing.sample,
    join: CONTEXTUAL_HINT_IDS.preprocessing.join,
    concat: CONTEXTUAL_HINT_IDS.preprocessing.stack,
    find: CONTEXTUAL_HINT_IDS.preprocessing.find,
    aggregate: CONTEXTUAL_HINT_IDS.preprocessing.create,
    expression: CONTEXTUAL_HINT_IDS.preprocessing.expression,
  }[activeSubtab];
  useProgressiveContextualHints([
    CONTEXTUAL_HINT_IDS.preprocessing.inputs,
    ...(operationReady ? [activeOperationHint] : []),
  ]);

  /**
   * Renders the single shared preprocessing input panel inside each active
   * subtab card so preprocessing matches the other functional tab layouts.
   */
  const renderNodeInputsPanel = () => (
    <div>
      <NodeInputsPanel
        guidanceTarget="preprocessing-inputs"
        resolvedNodes={nodeInputs.resolvedNodes}
        availableNodes={nodeInputs.availableNodes}
        canAddMore={nodeInputs.canAddMore}
        maxNodes={maxInputNodes}
        onAddNodes={nodeInputs.addNodes}
        onRemoveNode={nodeInputs.removeNode}
        onClear={nodeInputs.clear}
        onColumnChange={nodeInputs.setColumn}
        showColumnPicker={showInputColumnPicker}
        columnLabel={showInputColumnPicker ? preprocessingColumnLabel : undefined}
        title="Preprocessing Inputs"
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-semibold leading-none tracking-tight text-foreground">
              Data Preprocessing
            </h1>
            <InfoIcon
              targetKey="preprocessing.overview"
              label="About Data Preprocessing"
              tooltip="Learn what data preprocessing is and how it can help you."
            />
          </div>
          <p className="text-body text-description">
            Prepare your dataset with filtering, sampling, join, stack, find, and create tools.
          </p>
        </div>
      </div>

      <Tabs
        value={activeSubtab}
        onValueChange={(value) => {
          setActiveSubtab(value as DataPrepSubtab);
        }}
        className="space-y-4"
      >
        <EditorTabs
          aria-label="Data preprocessing sub-views"
          tabs={PREPROCESSING_TABS}
          activeTabId={activeSubtab}
          onActivate={(id) => {
            setActiveSubtab(id as DataPrepSubtab);
          }}
        />

        <TabsContent
          id="preprocessing-panel-filter"
          aria-labelledby="preprocessing-tab-filter"
          value="filter"
          className="space-y-4"
        >
          <FilterSubTab
            renderNodeInputsPanel={renderNodeInputsPanel}
            selectedNodeId={selectedNodeId}
            selectedNode={selectedNode}
            columnOptions={selectedNodeColumnOptions}
            currentWorkspaceId={currentWorkspaceId}
            filterNode={guidedFilterNode}
            filterPreview={guidedFilterPreview}
            isLoading={isLoading}
            onAlert={handleAlert}
            applyMode={applyMode}
            onApplyModeChange={setApplyMode}
          />
        </TabsContent>

        <TabsContent
          id="preprocessing-panel-slice"
          aria-labelledby="preprocessing-tab-slice"
          value="slice"
          className="space-y-4"
        >
          <SliceSubTab
            renderNodeInputsPanel={renderNodeInputsPanel}
            currentWorkspaceId={currentWorkspaceId}
            selectedNodeId={selectedNodeId}
            selectedNode={selectedNode}
            sliceNode={guidedSliceNode}
            slicePreview={guidedSlicePreview}
            isLoading={isLoading}
            onAlert={handleAlert}
          />
        </TabsContent>

        <TabsContent
          id="preprocessing-panel-join"
          aria-labelledby="preprocessing-tab-join"
          value="join"
          className="space-y-4"
        >
          <JoinSubTab
            renderNodeInputsPanel={renderNodeInputsPanel}
            selectedNodeIds={selectedNodeIds}
            selectedNodeColumns={selectedNodeColumns}
            setSelectedNodeColumns={setSelectedJoinColumns}
            currentWorkspaceId={currentWorkspaceId}
            workspaceNodes={workspaceNodes}
            getColumnInfos={nodeInputs.getColumnInfos}
            joinNodes={guidedJoinNodes}
            onPreviewSuccess={() => {
              reachContextualHint(CONTEXTUAL_HINT_IDS.preprocessing.preview);
            }}
            isLoading={isLoading}
            onAlert={handleAlert}
          />
        </TabsContent>

        <TabsContent
          id="preprocessing-panel-concat"
          aria-labelledby="preprocessing-tab-concat"
          value="concat"
          className="space-y-4"
        >
          <ConcatSubTab
            renderNodeInputsPanel={renderNodeInputsPanel}
            selectedNodeIds={selectedNodeIds}
            currentWorkspaceId={currentWorkspaceId}
            workspaceNodes={workspaceNodes}
            getColumnInfos={nodeInputs.getColumnInfos}
            concatNodes={guidedConcatNodes}
            concatPreview={guidedConcatPreview}
            isLoading={isLoading}
            onAlert={handleAlert}
          />
        </TabsContent>

        <TabsContent
          id="preprocessing-panel-find"
          aria-labelledby="preprocessing-tab-find"
          value="find"
          className="space-y-4"
        >
          <ReplaceSubTab
            renderNodeInputsPanel={renderNodeInputsPanel}
            currentWorkspaceId={currentWorkspaceId}
            selectedColumn={selectedNodeId ? (selectedNodeColumns[selectedNodeId] ?? '') : ''}
            selectedNodes={selectedNodes}
            getColumnInfos={nodeInputs.getColumnInfos}
            isLoading={isLoading}
            onAlert={handleAlert}
            replaceTextPreview={guidedReplaceTextPreview}
            replaceText={guidedReplaceText}
            refreshNodeSchema={refreshNodeSchema}
            applyMode={applyMode}
            onApplyModeChange={setApplyMode}
          />
        </TabsContent>

        <TabsContent
          id="preprocessing-panel-aggregate"
          aria-labelledby="preprocessing-tab-aggregate"
          value="aggregate"
          className="space-y-4"
        >
          <AggregateSubTab
            renderNodeInputsPanel={renderNodeInputsPanel}
            currentWorkspaceId={currentWorkspaceId}
            selectedNodes={selectedNodes}
            getColumnInfos={nodeInputs.getColumnInfos}
            isLoading={isLoading}
            onAlert={handleAlert}
            polarsExpressionPreview={guidedExpressionPreview}
            polarsExpressionApply={guidedExpressionApply}
            refreshNodeSchema={refreshNodeSchema}
            applyMode={applyMode}
            onApplyModeChange={setApplyMode}
          />
        </TabsContent>

        <TabsContent
          id="preprocessing-panel-expression"
          aria-labelledby="preprocessing-tab-expression"
          value="expression"
          className="space-y-4"
        >
          <Suspense fallback={<PolarsExpressionFallback />}>
            <TypedExpressionSubTab
              renderNodeInputsPanel={renderNodeInputsPanel}
              currentWorkspaceId={currentWorkspaceId}
              selectedNodes={selectedNodes}
              isLoading={isLoading}
              onAlert={handleAlert}
              polarsExpressionPreview={guidedExpressionPreview}
              polarsExpressionApply={guidedExpressionApply}
              refreshNodeSchema={refreshNodeSchema}
              applyMode={applyMode}
              onApplyModeChange={setApplyMode}
            />
          </Suspense>
        </TabsContent>
      </Tabs>

      {/* Shared Alert Dialog for error messages */}
      <AlertDialog open={alertOpen} onOpenChange={setAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Alert</AlertDialogTitle>
            <AlertDialogDescription>{alertMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                setAlertOpen(false);
              }}
            >
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default DataPreprocessingFeature;
