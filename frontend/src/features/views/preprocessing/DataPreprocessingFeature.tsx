import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calculator, Code2, Filter, Layers, Merge, Search, Shuffle } from 'lucide-react';
import { getNodeData } from '@/api/generated/sdk.gen';
import type { NodeDataResponse } from '@/api';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useWorkspaceStatus } from '@/features/workspace/common/hooks/useWorkspaceStatus';
import { NodeInputsPanel } from '@/features/views/common/components/NodeInputsPanel';
import type { NodeSelectionRenderArgs } from '@/features/views/common/components/NodeSelectionList';
import { useTabNodeInputs } from '@/features/views/common/nodeInputs';
import { queryKeys } from '@/lib/queryKeys';
import {
  preprocessingInputsKey,
  usePreprocessingInputsStore,
} from '@/stores/preprocessingInputsStore';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FilterSubTab } from './filter/FilterSubTab';
import { JoinSubTab } from './join/JoinSubTab';
import { ConcatSubTab } from './concat/ConcatSubTab';
import { SliceSubTab } from './slice/SliceSubTab';
import { AggregateSubTab } from './aggregate/AggregateSubTab';
import { ReplaceSubTab } from './replace/ReplaceSubTab';
import InfoIcon from '@/components/help/InfoIcon';
import { PolarsExpressionSubTab } from './expression/PolarsExpressionSubTab';

type DataPrepSubtab = 'filter' | 'slice' | 'join' | 'concat' | 'find' | 'aggregate' | 'expression';

const EMPTY_PREPROCESSING_INPUTS: [] = [];

// Hosts preprocessing subtabs and passes the active input node context into each tool.
/**
 * Rendered by: the analysis feature registry when this panel is selected because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: read workspace/auth state, derive inputs and analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 */
function DataPreprocessingFeature() {
  const { currentWorkspaceId, nodes: workspaceNodes = [] } = useWorkspaceData();
  const { getAuthHeaders, isAuthenticated } = useAuth();
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

  const preprocessingInputKey = preprocessingInputsKey(currentWorkspaceId, activeSubtab);
  const persistedInputs = usePreprocessingInputsStore(
    (state) => state.byKey[preprocessingInputKey] ?? EMPTY_PREPROCESSING_INPUTS,
  );
  const setPersistedInputs = usePreprocessingInputsStore((state) => state.setInputs);
  const isMultiNodeSubtab = activeSubtab === 'join' || activeSubtab === 'concat';
  const maxInputNodes = isMultiNodeSubtab ? 12 : 1;
  const nodeInputs = useTabNodeInputs({
    tabInputs: persistedInputs,
    onTabInputsChange: (inputs) => {
      if (!currentWorkspaceId) return;
      setPersistedInputs(currentWorkspaceId, activeSubtab, inputs);
    },
    constraints: {
      maxNodes: maxInputNodes,
      ...(activeSubtab === 'find' ? { allowedDataTypes: ['string'] } : {}),
    },
  });
  const selectedNodes = nodeInputs.selectedNodes;
  const selectedNode = selectedNodes[0] ?? null;
  const selectedNodeIds = nodeInputs.resolvedNodes.map((node) => node.id);
  const selectedNodeId = selectedNodeIds[0] ?? null;
  const selectedNodeColumns = Object.fromEntries(
    nodeInputs.resolvedNodes.map((node) => [node.id, node.column]),
  );
  const showInputColumnPicker = activeSubtab === 'find' || activeSubtab === 'join';
  const preprocessingColumnLabel = ({ nodeId }: NodeSelectionRenderArgs) => {
    if (activeSubtab === 'join') {
      if (nodeId === selectedNodeIds[0]) return 'Left column:';
      if (nodeId === selectedNodeIds[1]) return 'Right column:';
      return 'Join column:';
    }
    return 'Text column:';
  };

  const activeInputNodeDataQuery = useQuery({
    queryKey: queryKeys.nodeData(currentWorkspaceId ?? '', selectedNodeId ?? '', 1, 1),
    queryFn: async (): Promise<NodeDataResponse> => {
      if (!currentWorkspaceId || !selectedNodeId) {
        throw new Error('Missing preprocessing workspace or node ID');
      }
      const { data } = await getNodeData({
        headers: getAuthHeaders(),
        path: { node_id: selectedNodeId },
        query: { page: 1, page_size: 1 },
        throwOnError: true,
      });
      return data;
    },
    enabled: isAuthenticated && !!currentWorkspaceId && !!selectedNodeId,
    staleTime: 30 * 1000,
  });

  const activeInputNodeData = activeInputNodeDataQuery.data ?? null;
  const preprocessingLoading = {
    ...isLoading,
    nodeData: activeInputNodeDataQuery.isLoading,
  };

  // Gives child subtabs one shared alert surface for validation and backend errors.
  /**
   * Called by: DataPreprocessingFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleAlert = (message: string) => {
    setAlertMessage(message);
    setAlertOpen(true);
  };

  /**
   * Renders the single shared preprocessing input panel inside each active
   * subtab card so preprocessing matches the other functional tab layouts.
   */
  const renderNodeInputsPanel = () => (
    <div
      data-hint-id={activeSubtab === 'filter' ? 'preprocessing.filter.node-selection' : undefined}
    >
      <NodeInputsPanel
        resolvedNodes={nodeInputs.resolvedNodes}
        availableNodes={nodeInputs.availableNodes}
        graphSelectedIds={nodeInputs.graphSelectedIds}
        recentPresets={nodeInputs.recentPresets}
        canAddMore={nodeInputs.canAddMore}
        maxNodes={maxInputNodes}
        onAddNodes={nodeInputs.addNodes}
        getAddRejection={nodeInputs.getAddRejection}
        onRemoveNode={nodeInputs.removeNode}
        onClear={nodeInputs.clear}
        onColumnChange={nodeInputs.setColumn}
        nodeColors={{}}
        onColorChange={() => {}}
        defaultPalette={['#2563eb', '#16a34a', '#f59e0b', '#ef4444']}
        showColorPicker={false}
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
          <p className="text-sm text-muted-foreground">
            Prepare your dataset with filtering, sampling, join, stack, find, and create tools.
          </p>
        </div>
      </div>

      <Tabs
        value={activeSubtab}
        onValueChange={(value) => setActiveSubtab(value as DataPrepSubtab)}
        className="space-y-4"
      >
        <TabsList aria-label="Data preprocessing sub-views" className="flex flex-wrap gap-2">
          <TabsTrigger value="filter">
            <Filter className="mr-1.5 h-4 w-4" />
            Filter
          </TabsTrigger>
          <TabsTrigger value="slice">
            <Shuffle className="mr-1.5 h-4 w-4" />
            Sample
          </TabsTrigger>
          <TabsTrigger value="join">
            <Merge className="mr-1.5 h-4 w-4" />
            Join
          </TabsTrigger>
          <TabsTrigger value="concat">
            <Layers className="mr-1.5 h-4 w-4" />
            Stack
          </TabsTrigger>
          <TabsTrigger value="find">
            <Search className="mr-1.5 h-4 w-4" />
            Find
          </TabsTrigger>
          <TabsTrigger value="aggregate">
            <Calculator className="mr-1.5 h-4 w-4" />
            Create
          </TabsTrigger>
          <TabsTrigger value="expression">
            <Code2 className="mr-1.5 h-4 w-4" />
            Polars Expression
          </TabsTrigger>
        </TabsList>

        <TabsContent value="filter" className="space-y-4">
          <FilterSubTab
            renderNodeInputsPanel={renderNodeInputsPanel}
            selectedNodeId={selectedNodeId}
            selectedNode={selectedNode}
            selectedNodes={selectedNodes}
            nodeData={activeInputNodeData}
            currentWorkspaceId={currentWorkspaceId}
            workspaceNodes={workspaceNodes}
            filterNode={filterNode}
            filterPreview={filterPreview}
            isLoading={preprocessingLoading}
            onAlert={handleAlert}
          />
        </TabsContent>

        <TabsContent value="slice" className="space-y-4">
          <SliceSubTab
            renderNodeInputsPanel={renderNodeInputsPanel}
            selectedNodeId={selectedNodeId}
            selectedNode={selectedNode}
            selectedNodes={selectedNodes}
            workspaceNodes={workspaceNodes}
            sliceNode={sliceNode}
            slicePreview={slicePreview}
            isLoading={preprocessingLoading}
            onAlert={handleAlert}
          />
        </TabsContent>

        <TabsContent value="join" className="space-y-4">
          <JoinSubTab
            renderNodeInputsPanel={renderNodeInputsPanel}
            selectedNodeIds={selectedNodeIds}
            selectedNodeColumns={selectedNodeColumns}
            currentWorkspaceId={currentWorkspaceId}
            workspaceNodes={workspaceNodes}
            joinNodes={joinNodes}
            isLoading={preprocessingLoading}
            onAlert={handleAlert}
          />
        </TabsContent>

        <TabsContent value="concat" className="space-y-4">
          <ConcatSubTab
            renderNodeInputsPanel={renderNodeInputsPanel}
            selectedNodeIds={selectedNodeIds}
            currentWorkspaceId={currentWorkspaceId}
            workspaceNodes={workspaceNodes}
            concatNodes={concatNodes}
            concatPreview={concatPreview}
            isLoading={preprocessingLoading}
            onAlert={handleAlert}
          />
        </TabsContent>

        <TabsContent value="find" className="space-y-4">
          <ReplaceSubTab
            renderNodeInputsPanel={renderNodeInputsPanel}
            selectedNodeId={selectedNodeId}
            selectedColumn={selectedNodeId ? (selectedNodeColumns[selectedNodeId] ?? '') : ''}
            selectedNodes={selectedNodes}
            workspaceNodes={workspaceNodes}
            isLoading={preprocessingLoading}
            onAlert={handleAlert}
            replaceTextPreview={replaceTextPreview}
            replaceText={replaceText}
            refreshNodeSchema={refreshNodeSchema}
          />
        </TabsContent>

        <TabsContent value="aggregate" className="space-y-4">
          <AggregateSubTab
            renderNodeInputsPanel={renderNodeInputsPanel}
            selectedNodeId={selectedNodeId}
            selectedNodes={selectedNodes}
            workspaceNodes={workspaceNodes}
            isLoading={preprocessingLoading}
            onAlert={handleAlert}
            polarsExpressionPreview={polarsExpressionPreview}
            polarsExpressionApply={polarsExpressionApply}
            refreshNodeSchema={refreshNodeSchema}
          />
        </TabsContent>

        <TabsContent value="expression" className="space-y-4">
          <PolarsExpressionSubTab
            renderNodeInputsPanel={renderNodeInputsPanel}
            selectedNodeId={selectedNodeId}
            selectedNodes={selectedNodes}
            workspaceNodes={workspaceNodes}
            isLoading={preprocessingLoading}
            onAlert={handleAlert}
            polarsExpressionPreview={polarsExpressionPreview}
            polarsExpressionApply={polarsExpressionApply}
            refreshNodeSchema={refreshNodeSchema}
          />
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
            <AlertDialogAction onClick={() => setAlertOpen(false)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default DataPreprocessingFeature;
