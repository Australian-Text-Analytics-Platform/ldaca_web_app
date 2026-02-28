export type SidebarTaskStatus =
  | 'pending'
  | 'running'
  | 'successful'
  | 'failed'
  | 'cancelled'
  | string;

export type SidebarTaskRecord = {
  task_id: string;
  task_type?: string;
  state?: SidebarTaskStatus;
  metadata?: {
    name?: string;
    [key: string]: unknown;
  };
  message?: string;
  created_at?: number | string;
  started_at?: number | string | null;
  finished_at?: number | string | null;
  progress?: number;
  progress_message?: string;
};

export type SidebarNodeShape = [number | null, number | null];

export type SidebarWorkspaceNode = {
  id: string;
  name?: string;
  label?: string;
  type?: string;
  operation?: string;
  data?: {
    nodeName?: string;
    label?: string;
    nodeType?: string;
    dataType?: string;
    shape?: SidebarNodeShape;
    [key: string]: unknown;
  };
};
