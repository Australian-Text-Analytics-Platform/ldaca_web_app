import { httpRequest, post } from '../http';

export interface AiAnnotationClassDef {
  name: string;
  description: string;
}

export interface AiAnnotationExample {
  query: string;
  classification: string;
}

export interface AiAnnotationRequest {
  node_ids: string[];
  node_columns: Record<string, string>;
  annotation_column?: string | null;
  classes: AiAnnotationClassDef[];
  examples?: AiAnnotationExample[];
  model: string;
  api_key?: string | null;
  base_url?: string | null;
  temperature?: number;
  top_p?: number;
  seed?: number | null;
  batch_size?: number;
  page?: number;
  page_size?: number;
  sort_by?: string | null;
  descending?: boolean;
}

export interface AiAnnotationDetachRequest {
  column: string;
  new_node_name?: string | null;
  annotation_column?: string | null;
  classes: AiAnnotationClassDef[];
  examples?: AiAnnotationExample[];
  model: string;
  api_key?: string | null;
  base_url?: string | null;
  temperature?: number;
  top_p?: number;
  seed?: number | null;
  batch_size?: number;
}

export interface AiAnnotationEdit {
  row_index: number;
  provider: string;
  annotation: string;
}

export interface AiAnnotationSaveRequest {
  annotation_column?: string | null;
  edits: AiAnnotationEdit[];
}

export interface AiAnnotationNodeResult {
  data: Array<Record<string, unknown>>;
  columns: string[];
  metadata?: Record<string, unknown>;
  pagination?: {
    page: number;
    page_size: number;
    total_source_rows?: number;
    total_source_pages?: number;
    result_count?: number;
    has_next: boolean;
    has_prev: boolean;
  };
  sorting?: {
    sort_by?: string | null;
    descending: boolean;
  };
}

export interface AiAnnotationResultQuery {
  page?: number;
  page_size?: number;
  sort_by?: string | null;
  descending?: boolean;
}

export interface AiAnnotationResponse {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  message: string;
  data?: Record<string, AiAnnotationNodeResult> | null;
  analysis_params?: Record<string, unknown>;
  combinable?: boolean;
  metadata?: { task_id?: string; [k: string]: unknown };
}

export interface AiAnnotationModelsRequest {
  base_url?: string | null;
  api_key?: string | null;
}

export interface AiAnnotationModelsResponse {
  state: 'successful' | 'failed';
  message: string;
  data?: {
    models?: Array<{ id: string; name: string }>;
  };
  metadata?: Record<string, unknown>;
}

export interface AiAnnotationProvidersResponse {
  state: 'successful' | 'failed';
  message: string;
  data?: {
    providers?: string[];
  };
  metadata?: Record<string, unknown>;
}

export interface AiAnnotationCategoriesResponse {
  state: 'successful' | 'failed';
  message: string;
  data?: {
    categories?: string[];
  };
  metadata?: Record<string, unknown>;
}

export const aiAnnotationApi = {
  aiAnnotationModels: (
    body: AiAnnotationModelsRequest,
    headers: Record<string, string> = {},
  ) =>
    post<AiAnnotationModelsResponse>(`/workspaces/ai-annotation/models`, body, headers),

  aiAnnotation: (req: AiAnnotationRequest, headers: Record<string, string> = {}) =>
    post<AiAnnotationResponse>(`/workspaces/ai-annotation`, req, headers),

  aiAnnotationDetach: (
    node: string,
    req: AiAnnotationDetachRequest,
    headers: Record<string, string> = {},
  ) =>
    post<Record<string, unknown>>(`/workspaces/nodes/${node}/ai-annotation/detach`, req, headers),

  aiAnnotationSave: (
    node: string,
    req: AiAnnotationSaveRequest,
    headers: Record<string, string> = {},
  ) =>
    post<Record<string, unknown>>(`/workspaces/nodes/${node}/ai-annotation/save`, req, headers),

  aiAnnotationProviders: (
    node: string,
    annotationColumn: string,
    headers: Record<string, string> = {},
  ) =>
    httpRequest<AiAnnotationProvidersResponse>(
      `/workspaces/nodes/${node}/ai-annotation/providers`,
      {
        method: 'GET',
        headers,
        params: { annotation_column: annotationColumn },
      },
    ),

  aiAnnotationCategories: (
    node: string,
    annotationColumn: string,
    headers: Record<string, string> = {},
  ) =>
    httpRequest<AiAnnotationCategoriesResponse>(
      `/workspaces/nodes/${node}/ai-annotation/categories`,
      {
        method: 'GET',
        headers,
        params: { annotation_column: annotationColumn },
      },
    ),

  clearAiAnnotation: (headers: Record<string, string> = {}) =>
    httpRequest<{ state: string; message: string }>(
      `/workspaces/ai-annotation`,
      { method: 'DELETE', headers },
    ),

  getAiAnnotationTaskRequest: (taskId: string, headers: Record<string, string> = {}) =>
    httpRequest<Record<string, unknown>>(
      `/workspaces/ai-annotation/tasks/${taskId}/request`,
      { method: 'GET', headers },
    ),

  getAiAnnotationTaskResult: (taskId: string, headers: Record<string, string> = {}) =>
    httpRequest<AiAnnotationResponse>(
      `/workspaces/ai-annotation/tasks/${taskId}/result`,
      { method: 'GET', headers },
    ),

  postAiAnnotationTaskResult: (
    taskId: string,
    body: AiAnnotationResultQuery,
    headers: Record<string, string> = {},
  ) =>
    post<AiAnnotationResponse>(
      `/workspaces/ai-annotation/tasks/${taskId}/result`,
      body,
      headers,
    ),
};
