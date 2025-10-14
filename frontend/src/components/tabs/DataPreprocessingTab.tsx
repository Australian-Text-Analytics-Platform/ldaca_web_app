import React, { useState } from 'react';
import { useWorkspaceSelection } from '../../hooks/useWorkspaceSelection';
import { useWorkspaceData } from '../../hooks/useWorkspaceData';
import { useWorkspaceActions } from '../../hooks/useWorkspaceActions';
import { useWorkspaceStatus } from '../../hooks/useWorkspaceStatus';
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { FilterSubTab } from '../preprocessing/FilterSubTab';
import { JoinSubTab } from '../preprocessing/JoinSubTab';
import { ConcatSubTab } from '../preprocessing/ConcatSubTab';
import { SliceSubTab } from '../preprocessing/SliceSubTab';
import { AggregateSubTab } from '../preprocessing/AggregateSubTab';

type DataPrepSubtab = 'filter' | 'slice' | 'join' | 'concat' | 'aggregate';

const DataPreprocessingTab: React.FC = () => {
  const { selectedNodeId, selectedNode, selectedNodes, selectedNodeIds } = useWorkspaceSelection();
  const { nodeData, currentWorkspaceId, nodes: workspaceNodes = [], getNodeShape } = useWorkspaceData();
  const { filterNode, filterPreview, joinNodes, concatNodes, concatPreview } = useWorkspaceActions();
  const { isLoading } = useWorkspaceStatus();

  const [activeSubtab, setActiveSubtab] = useState<DataPrepSubtab>('filter');
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');

  const handleAlert = (message: string) => {
    setAlertMessage(message);
    setAlertOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Data Preprocessing</h1>
          <p className="text-sm text-muted-foreground">
            Prepare your dataset with filtering and upcoming slice, join, concat, and aggregate tools.
          </p>
        </div>
      </div>
      
      <Tabs
        value={activeSubtab}
        onValueChange={(value) => setActiveSubtab(value as DataPrepSubtab)}
        className="space-y-6"
      >
        <TabsList aria-label="Data preprocessing sub-views" className="flex flex-wrap gap-2">
          <TabsTrigger value="filter">Filter</TabsTrigger>
          <TabsTrigger value="slice">Slice</TabsTrigger>
          <TabsTrigger value="join">Join</TabsTrigger>
          <TabsTrigger value="concat">Concat</TabsTrigger>
          <TabsTrigger value="aggregate">Aggregate</TabsTrigger>
        </TabsList>

        <TabsContent value="filter" className="space-y-6">
          <FilterSubTab
            selectedNodeId={selectedNodeId}
            selectedNode={selectedNode}
            selectedNodes={selectedNodes}
            nodeData={nodeData}
            currentWorkspaceId={currentWorkspaceId}
            workspaceNodes={workspaceNodes}
            getNodeShape={getNodeShape}
            filterNode={filterNode}
            filterPreview={filterPreview}
            isLoading={isLoading}
            onAlert={handleAlert}
          />
        </TabsContent>

        <TabsContent value="slice" className="space-y-6">
          <SliceSubTab />
        </TabsContent>

        <TabsContent value="join" className="space-y-6">
          <JoinSubTab
            selectedNodeIds={selectedNodeIds}
            currentWorkspaceId={currentWorkspaceId}
            workspaceNodes={workspaceNodes}
            getNodeShape={getNodeShape}
            joinNodes={joinNodes}
            isLoading={isLoading}
            onAlert={handleAlert}
          />
        </TabsContent>

        <TabsContent value="concat" className="space-y-6">
          <ConcatSubTab
            selectedNodeIds={selectedNodeIds}
            currentWorkspaceId={currentWorkspaceId}
            workspaceNodes={workspaceNodes}
            getNodeShape={getNodeShape}
            concatNodes={concatNodes}
            concatPreview={concatPreview}
            isLoading={isLoading}
            onAlert={handleAlert}
          />
        </TabsContent>

        <TabsContent value="aggregate" className="space-y-6">
          <AggregateSubTab />
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

export default DataPreprocessingTab;
