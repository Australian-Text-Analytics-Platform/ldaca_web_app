type SidebarTaskStatus =
  | 'queued'
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
