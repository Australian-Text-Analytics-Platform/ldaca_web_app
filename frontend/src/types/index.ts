export interface User {
  id: string;
  name: string;
  email: string;
  picture: string | null;
  is_active?: boolean;
  is_verified?: boolean;
  created_at?: string;
  last_login?: string;
}

// Remove GoogleUser - we only need one User interface

export interface FileTreeFile {
  name: string;
  path: string;
  type: 'file';
  size: number;
}

export interface FileTreeDirectory {
  name: string;
  path: string;
  type: 'directory';
  children: FileTreeNode[];
}

export type FileTreeNode = FileTreeFile | FileTreeDirectory;

export interface FileData {
  files: string[];
}

export interface DataFrameResponse {
  dataframe: Record<string, unknown>[];
  total_pages?: number;
}

export interface FilePreviewResponse {
  data: Record<string, unknown>[];
  columns: string[];
  total_rows: number;
  preview_rows: number;
  file_info: {
    filename: string;
    size: number;
    type: string;
    modified: string;
  };
}

export interface UserMeResponse {
  user: User;
  authenticated: boolean;
  expires_at: string;
}

export interface UserStorageInfo {
  used_space_mb: number;
  file_count: number;
  folders: string[];
}

export type NodeShape = [number | null, number | null];

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  total_nodes: number;
}

export type TabType = 'data-loader' | 'analysis' | 'export';

// Workspace management types
export interface WorkspaceInfo {
  id: string;
  name: string;
  created_at: string;
  modified_at: string;
  description?: string;
  total_nodes?: number;
  dataframe_count: number;
  is_saved: boolean;
}

export interface WorkspaceNode {
  node_id: string;
  name: string;
  shape: NodeShape;
  columns: string[];
  preview: Record<string, unknown>[];
  is_text_data: boolean;
  can_undo?: boolean;
  can_redo?: boolean;
  data_type?: string; // e.g., 'polars.dataframe.frame.DataFrame', 'pandas.core.frame.DataFrame'
  column_schema?: Record<string, string>; // Column name to data type mapping
  dtypes?: Record<string, string>; // Alternative name for column types
  [key: string]: unknown;
}

export interface NodeSchemaResponse {
  node_id: string;
  schema: Record<string, string>;
  columns: string[];
  column_types: Record<string, string>;
  is_text_data: boolean;
  document_column?: string;
}

export interface NodeDataResponse {
  data: Record<string, unknown>[];
  total_rows: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface WorkspaceListResponse {
  workspaces: WorkspaceInfo[];
}

export interface WorkspaceNodesResponse {
  nodes: WorkspaceNode[];
}

export interface WorkspaceCreateRequest {
  name: string;
  description?: string;
}

// =============================================================================
// UNIFIED AUTH TYPES (matching backend models)
// =============================================================================

export interface AuthMethod {
  name: string;
  display_name: string;
  enabled: boolean;
}

export interface AuthInfoResponse {
  authenticated: boolean;
  user: User | null;
  available_auth_methods: AuthMethod[];
  requires_authentication: boolean;
  data_folder?: string; // Only present in single-user mode
}

export interface GoogleAuthRequest {
  id_token: string;
}

export interface GoogleAuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  user: User;
}
