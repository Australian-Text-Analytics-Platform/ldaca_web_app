import { memo } from 'react';

import { WorkspaceDataTableFeature } from '@/features/workspace/data-view';

export const WorkspaceDataView = memo(() => {
  return <WorkspaceDataTableFeature />;
});

WorkspaceDataView.displayName = 'WorkspaceDataView';
