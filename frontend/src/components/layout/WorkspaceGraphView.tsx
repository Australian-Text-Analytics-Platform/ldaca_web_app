import { memo } from 'react';

import { WorkspaceGraphFeature } from '@/features/workspace/graph-view';

export const WorkspaceGraphView = memo(() => {
  return <WorkspaceGraphFeature />;
});

WorkspaceGraphView.displayName = 'WorkspaceGraphView';
