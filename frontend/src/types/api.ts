/**
 * Enhanced TypeScript types for the ATAP Web App
 * Provides type safety and better development experience
 */

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: any;
}

// Workspace Types
export interface WorkspaceInfo {
  workspace_id: string;
  name: string;
  description: string;  
  created_at: string;
  modified_at: string;
  total_nodes: number;
}

export interface WorkspaceListResponse {
  workspaces: WorkspaceInfo[];
}

export interface CreateWorkspaceRequest {
  name: string;
  description?: string;
}

// Node Types
export interface NodeInfo {
  id: string;
  name: string;
  data_type: string;
  shape: [number, number];
  columns: string[];
  schema: Record<string, string>;
  operation?: string;
  created_at?: string;
  parent_ids?: string[];
}

export interface NodeData {
  [key: string]: any;
}

export interface NodeDataResponse {
  data: NodeData[];
  total_rows: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// Graph Types
export interface GraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    id: string;
    name: string;
    info: NodeInfo;
    onDelete?: (nodeId: string) => void;
    onRename?: (nodeId: string, newName: string) => void;
    onSelect?: (nodeId: string) => void;
    onConvertToDocDataFrame?: (nodeId: string, documentColumn: string) => void;
  };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  animated?: boolean;
}

export interface WorkspaceGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  workspace_info: WorkspaceInfo;
}

// Operation Types
export interface FilterCondition {
  column: string;
  operator: string;
  value: any;
  id?: string;
  dataType?: string;
}

export interface FilterRequest {
  conditions: FilterCondition[];
  logic?: string;
  new_node_name?: string;
}

export interface JoinRequest {
  left_node_id: string;
  right_node_id: string;
  join_type: 'inner' | 'left' | 'right' | 'outer';
  left_columns: string[];
  right_columns: string[];
  description?: string;
}

export interface RenameRequest {
  new_name: string;
}

export interface CastRequest {
  column: string;
  target_type: string;
  datetime_format?: string;
}

export interface SliceRequest {
  start_row: number;
  end_row: number;
  description?: string;
}

export interface ConcordanceRequest {
  column: string;
  search_word: string;
  num_left_tokens?: number;
  num_right_tokens?: number;
  regex?: boolean;
  case_sensitive?: boolean;
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

// File Types
export interface FileInfo {
  name: string;
  size: number;
  type: string;
  last_modified: string;
}

export interface FileListResponse {
  files: FileInfo[];
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

// Auth Types  
export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export interface AuthResponse {
  access_token: string;
  user: User;
  expires_in?: number;
}

// Query Types for React Query
export interface QueryOptions {
  enabled?: boolean;
  staleTime?: number;
  refetchOnWindowFocus?: boolean;
  retry?: boolean | number;
}

export interface MutationOptions<TData = any, TError = ApiError, TVariables = any> {
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: TError, variables: TVariables) => void;
  onSettled?: (data: TData | undefined, error: TError | null, variables: TVariables) => void;
}

// Error Types
export interface ErrorInfo {
  message: string;
  stack?: string;
  componentStack?: string;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

// Loading States
export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

export interface OperationState {
  state: LoadingState;
  error?: string;
  data?: any;
}

// Utility Types
export type RequiredBy<T, K extends keyof T> = T & Required<Pick<T, K>>;
export type OptionalBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// Generic API operation result
export interface OperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

// Hook return types
export interface UseQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

export interface UseMutationResult<TData, TVariables> {
  mutate: (variables: TVariables) => void;
  mutateAsync: (variables: TVariables) => Promise<TData>;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: ApiError | null;
  data: TData | undefined;
  reset: () => void;
}
