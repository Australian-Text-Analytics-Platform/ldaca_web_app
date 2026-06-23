type SidebarTaskStatus =
  | 'pending'
  | 'running'
  | 'successful'
  | 'failed'
  | 'cancelled'
  // Keep literal autocomplete while still accepting arbitrary backend status strings.
  | (string & {});

export interface SidebarTaskRecord {
  task_id: string;
  task_type?: string;
  name?: string;
  user_id?: string;
  workspace_id?: string;
  parent_task_id?: string | null;
  state?: SidebarTaskStatus;
  message?: string;
  created_at?: number | string;
  started_at?: number | string | null;
  finished_at?: number | string | null;
  progress?: number;
  progress_message?: string;
}

type SidebarNodeShape = [number | null, number | null];

export interface SidebarWorkspaceNode {
  id: string;
  name?: string;
  label?: string;
  type?: string;
  operation?: string;
  /** Backend undo/redo availability, present on workspace-graph nodes. Used by
   * the right-panel list-view row toolbar to enable/disable undo/redo. */
  can_undo?: boolean;
  can_redo?: boolean;
  data?: {
    nodeName?: string;
    label?: string;
    nodeType?: string;
    dataType?: string;
    shape?: SidebarNodeShape;
    [key: string]: unknown;
  };
}
