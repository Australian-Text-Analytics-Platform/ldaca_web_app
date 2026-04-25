import React, { useState } from 'react';
import { Calculator, Code2, Filter, Layers, Merge, Search, Shuffle } from 'lucide-react';
import { useWorkspaceSelection } from '../../../hooks/useWorkspaceSelection';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useWorkspaceActions } from '../../../hooks/useWorkspaceActions';
import { useWorkspaceStatus } from '../../../hooks/useWorkspaceStatus';
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../../components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { FilterSubTab } from '../../preprocessing/filter/FilterSubTab';
import { JoinSubTab } from '../../preprocessing/join/JoinSubTab';
import { ConcatSubTab } from '../../preprocessing/concat/ConcatSubTab';
import { SliceSubTab } from '../../preprocessing/slice/SliceSubTab';
import { AggregateSubTab } from '../../preprocessing/aggregate/AggregateSubTab';
import { ReplaceSubTab } from '../../preprocessing/replace/ReplaceSubTab';
import { PolarsExpressionSubTab } from '../../preprocessing/expression/PolarsExpressionSubTab';

type DataPrepSubtab = 'filter' | 'slice' | 'join' | 'concat' | 'find' | 'aggregate' | 'expression';

const DataPreprocessingFeature: React.FC = () => {
  const { selectedNodeId, selectedNode, selectedNodes, selectedNodeIds } = useWorkspaceSelection();
  const { nodeData, currentWorkspaceId, nodes: workspaceNodes = [] } = useWorkspaceData();
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

  const handleAlert = (message: string) => {
    setAlertMessage(message);
    setAlertOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Data Preprocessing</h1>
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
          <TabsTrigger value="filter"><Filter className="mr-1.5 h-4 w-4" />Filter</TabsTrigger>
          <TabsTrigger value="slice"><Shuffle className="mr-1.5 h-4 w-4" />Sample</TabsTrigger>
          <TabsTrigger value="join"><Merge className="mr-1.5 h-4 w-4" />Join</TabsTrigger>
          <TabsTrigger value="concat"><Layers className="mr-1.5 h-4 w-4" />Stack</TabsTrigger>
          <TabsTrigger value="find"><Search className="mr-1.5 h-4 w-4" />Find</TabsTrigger>
          <TabsTrigger value="aggregate"><Calculator className="mr-1.5 h-4 w-4" />Create</TabsTrigger>
          <TabsTrigger value="expression"><Code2 className="mr-1.5 h-4 w-4" />Polars Expression</TabsTrigger>
        </TabsList>

        <TabsContent value="filter" className="space-y-4">
          <FilterSubTab
            selectedNodeId={selectedNodeId}
            selectedNode={selectedNode}
            selectedNodes={selectedNodes}
            nodeData={nodeData}
            currentWorkspaceId={currentWorkspaceId}
            workspaceNodes={workspaceNodes}
            filterNode={filterNode}
            filterPreview={filterPreview}
            isLoading={isLoading}
            onAlert={handleAlert}
          />
        </TabsContent>

        <TabsContent value="slice" className="space-y-4">
          <SliceSubTab
            selectedNodeId={selectedNodeId}
            selectedNode={selectedNode}
            selectedNodes={selectedNodes}
            workspaceNodes={workspaceNodes}
            sliceNode={sliceNode}
            slicePreview={slicePreview}
            isLoading={isLoading}
            onAlert={handleAlert}
          />
        </TabsContent>

        <TabsContent value="join" className="space-y-4">
          <JoinSubTab
            selectedNodeIds={selectedNodeIds}
            currentWorkspaceId={currentWorkspaceId}
            workspaceNodes={workspaceNodes}
            joinNodes={joinNodes}
            isLoading={isLoading}
            onAlert={handleAlert}
          />
        </TabsContent>

        <TabsContent value="concat" className="space-y-4">
          <ConcatSubTab
            selectedNodeIds={selectedNodeIds}
            currentWorkspaceId={currentWorkspaceId}
            workspaceNodes={workspaceNodes}
            concatNodes={concatNodes}
            concatPreview={concatPreview}
            isLoading={isLoading}
            onAlert={handleAlert}
          />
        </TabsContent>

        <TabsContent value="find" className="space-y-4">
          <ReplaceSubTab
            selectedNodeId={selectedNodeId}
            selectedNodes={selectedNodes}
            workspaceNodes={workspaceNodes}
            isLoading={isLoading}
            onAlert={handleAlert}
            replaceTextPreview={replaceTextPreview}
            replaceText={replaceText}
            refreshNodeSchema={refreshNodeSchema}
          />
        </TabsContent>

        <TabsContent value="aggregate" className="space-y-4">
          <AggregateSubTab
            selectedNodeId={selectedNodeId}
            selectedNodes={selectedNodes}
            workspaceNodes={workspaceNodes}
            isLoading={isLoading}
            onAlert={handleAlert}
            polarsExpressionPreview={polarsExpressionPreview}
            polarsExpressionApply={polarsExpressionApply}
            refreshNodeSchema={refreshNodeSchema}
          />
        </TabsContent>

        <TabsContent value="expression" className="space-y-4">
          <PolarsExpressionSubTab
            selectedNodeId={selectedNodeId}
            selectedNodes={selectedNodes}
            workspaceNodes={workspaceNodes}
            isLoading={isLoading}
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
            <AlertDialogDescription>
              {alertMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setAlertOpen(false)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DataPreprocessingFeature;
