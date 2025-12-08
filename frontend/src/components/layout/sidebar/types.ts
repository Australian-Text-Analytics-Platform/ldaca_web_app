export type SidebarTaskStatus = 'running' | 'successful' | 'failed' | 'cancelled';

export type SidebarTaskRecord = {
  task_id: string;
  task_type: string;
  state?: SidebarTaskStatus;
  metadata?: { name?: string };
  message?: string;
  created_at?: number;
  started_at?: number;
  finished_at?: number | null;
  progress?: number;
  progress_message?: string;
};

export type SidebarNodeShape = [number | null, number | null];

export type SidebarWorkspaceNode = {
  id: string;
  label?: string;
  type?: string;
  data?: {
    nodeName?: string;
    label?: string;
    nodeType?: string;
    dataType?: string;
    shape?: SidebarNodeShape;
    [key: string]: unknown;
  };
};

export type NodeShapeResult = {
  shape?: [number, number];
};
