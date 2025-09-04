// Replaced axios with lightweight fetch wrapper in request.ts
import { apiRequest, getJson, postJson, putJson, deleteReq } from './request';

// Determine API base URL based on current hostname and environment
// Exported so other utilities (e.g., health polling) can derive non-/api root.
export const getApiBase = () => {
  if (typeof window === 'undefined') return '/api';
  const { origin, hostname, pathname } = window.location;
  
  // Debug gated
  if (localStorage.getItem('debugApp') === '1') console.log('API Detection:', {
    hostname,
    origin,
    NODE_ENV: process.env.NODE_ENV,
    port: window.location.port
  });
  
  // If accessing through ldaca.sguo.org, use the /api proxy path
  if (hostname === 'ldaca.sguo.org') {
    return `${origin}/api`;
  }
  
  // If localhost with port 3000, use direct backend connection
  if (hostname === 'localhost' && window.location.port === '3000') {
    return 'http://localhost:8001/api';
  }

  // JupyterHub/Binder: preserve any base (/user/<name>/) and rewrite the proxied frontend port to backend 8001
  const m = pathname.match(/^(.*\/proxy\/)(\d+)(\/|$)/);
  if (m) {
    const prefix = m[1]; // e.g. /user/abc/proxy/
    return `${origin}${prefix}8001/api`;
  }

  // Default fallback
  return process.env.NODE_ENV === 'production' 
    ? `${origin}/api`
    : 'http://localhost:8001/api';
};

const API_BASE = getApiBase();

if (localStorage.getItem('debugApp') === '1') console.log('Final API_BASE:', API_BASE);

export interface GoogleAuthRequest {
  id_token: string;
}

export interface GoogleAuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
  last_login: string;
}

export interface UserMeResponse {
  user: User;
  authenticated: boolean;
  expires_at: string;
}

export interface FileInfo {
  filename: string;
  display_name: string;
  folder: string;
  size: number;
  created_at: number;
  file_type: string;
  // Legacy fields for backward compatibility
  modified?: string;
  type?: string;
}

export interface FileListResponse {
  files: FileInfo[];
  total: number;
  user_folder: string;
}

export interface ColumnUniqueValuesResponse {
  unique_count: number;
  sample_values: any[];
  has_more: boolean;
}

// =============================================================================
// AUTHENTICATION API
// =============================================================================

export async function googleAuth(idToken: string): Promise<GoogleAuthResponse> {
  return postJson(`${API_BASE}/auth/google`, { id_token: idToken }) as Promise<GoogleAuthResponse>;
}

export async function getAuthStatus(authHeaders: Record<string, string> = {}): Promise<UserMeResponse> {
  return getJson(`${API_BASE}/auth/status`, authHeaders) as Promise<UserMeResponse>;
}

export async function logout(authHeaders: Record<string, string> = {}) {
  return postJson(`${API_BASE}/auth/logout`, {}, authHeaders);
}

// =============================================================================
// FILE MANAGEMENT API
// =============================================================================

export async function getFiles(authHeaders: Record<string, string> = {}): Promise<FileListResponse> {
  return getJson(`${API_BASE}/files/`, authHeaders) as Promise<FileListResponse>;
}

export async function uploadFile(file: File, authHeaders: Record<string, string> = {}) {
  const formData = new FormData();
  formData.append('file', file);
  return apiRequest(`${API_BASE}/files/upload`, { method: 'POST', formData, headers: authHeaders });
}

export async function downloadFile(fileName: string, authHeaders: Record<string, string> = {}) {
  return apiRequest(`${API_BASE}/files/${encodeURIComponent(fileName)}`, { method: 'GET', headers: authHeaders, expectBlob: true });
}

export interface UnifiedFilePreviewRequest {
  filename: string;
  page?: number;
  page_size?: number;
  payload?: { sheet_name?: string };
}

export async function getUnifiedFilePreview(body: UnifiedFilePreviewRequest, authHeaders: Record<string, string> = {}) {
  return postJson(`${API_BASE}/files/preview`, body, authHeaders);
}

export async function getFileInfo(fileName: string, authHeaders: Record<string, string> = {}) {
  return getJson(`${API_BASE}/files/${encodeURIComponent(fileName)}/info`, authHeaders);
}

export async function deleteFile(fileName: string, authHeaders: Record<string, string> = {}) {
  return deleteReq(`${API_BASE}/files/${encodeURIComponent(fileName)}`, authHeaders);
}

// =============================================================================
// FEEDBACK API
// =============================================================================

export interface FeedbackRequestBody {
  subject: string;
  comments: string;
  email?: string;
}

export interface FeedbackResponseBody {
  success: boolean;
  message: string;
  record_id?: string;
  meta?: Record<string, any>;
}

export async function submitFeedback(body: FeedbackRequestBody, authHeaders: Record<string, string> = {}): Promise<FeedbackResponseBody> {
  return postJson(`${API_BASE}/feedback/submit`, body, authHeaders) as Promise<FeedbackResponseBody>;
}

// =============================================================================
// WORKSPACE MANAGEMENT API (Future Use)
// =============================================================================

export async function getWorkspaces(authHeaders: Record<string, string> = {}) {
  const data = await getJson(`${API_BASE}/workspaces/`, authHeaders) as any;
  return data.workspaces || [];
}

export async function createWorkspace(
  name: string,
  description: string = '',
  authHeaders: Record<string, string> = {}
) {
  const requestBody = { name, description };
  return postJson(`${API_BASE}/workspaces/`, requestBody, authHeaders);
}

export async function getWorkspaceInfo(workspaceId: string, authHeaders: Record<string, string> = {}) {
  return getJson(`${API_BASE}/workspaces/${workspaceId}`, authHeaders);
}

export async function deleteWorkspace(workspaceId: string, authHeaders: Record<string, string> = {}) {
  return deleteReq(`${API_BASE}/workspaces/${workspaceId}`, authHeaders);
}

export async function importWorkspace(file: File, authHeaders: Record<string, string> = {}) {
  const formData = new FormData();
  formData.append('file', file);
  return apiRequest(`${API_BASE}/workspaces/import`, { method: 'POST', formData, headers: authHeaders });
}

export async function getWorkspaceNodes(workspaceId: string, authHeaders: Record<string, string> = {}) {
  const data = await getJson(`${API_BASE}/workspaces/${workspaceId}/nodes`, authHeaders) as any;
  return data.nodes || [];
}

export async function createNodeFromFile(
  workspaceId: string,
  filename: string,
  nodeName?: string,
  authHeaders: Record<string, string> = {},
  options?: { mode?: 'DocLazyFrame' | 'LazyFrame' | 'DocDataFrame' | 'DataFrame'; document_column?: string | null }
) {
  return apiRequest(`${API_BASE}/workspaces/${workspaceId}/nodes`, {
    method: 'POST',
    headers: authHeaders,
    params: {
      filename,
      node_name: nodeName,
      mode: options?.mode ?? 'DocLazyFrame',
      document_column: options?.document_column ?? undefined,
    },
  });
}

export async function getNodeInfo(
  workspaceId: string, 
  nodeId: string, 
  authHeaders: Record<string, string> = {}
) {
  return getJson(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}`, authHeaders);
}

export async function getNodeData(
  workspaceId: string, 
  nodeId: string, 
  page: number = 0, 
  pageSize: number = 20, 
  authHeaders: Record<string, string> = {}
) {
  return apiRequest(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/data`, {
    method: 'GET',
    headers: authHeaders,
    params: { page, page_size: pageSize },
  });
}

export async function getNodeShape(
  workspaceId: string, 
  nodeId: string, 
  authHeaders: Record<string, string> = {}
) {
  return getJson(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/shape`, authHeaders);
}

export async function getColumnUniqueValues(
  workspaceId: string,
  nodeId: string,
  columnName: string,
  authHeaders: Record<string, string> = {}
): Promise<ColumnUniqueValuesResponse> {
  return getJson(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/columns/${columnName}/unique`, authHeaders) as Promise<ColumnUniqueValuesResponse>;
}

export async function deleteNode(
  workspaceId: string, 
  nodeId: string, 
  authHeaders: Record<string, string> = {}
) {
  return deleteReq(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}`, authHeaders);
}

export async function renameNode(
  workspaceId: string,
  nodeId: string,
  newName: string,
  authHeaders: Record<string, string> = {}
) {
  // RESTful endpoint only
  return apiRequest(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/name`, {
    method: 'PUT',
    headers: authHeaders,
    params: { new_name: newName },
  });
}

// =============================================================================
// USER MANAGEMENT API
// =============================================================================

export async function getUserFolders(authHeaders: Record<string, string> = {}) {
  return getJson(`${API_BASE}/user/folders`, authHeaders);
}

export async function getUserStorage(authHeaders: Record<string, string> = {}) {
  return getJson(`${API_BASE}/user/storage`, authHeaders);
}

// =============================================================================
// LEGACY COMPATIBILITY (to be updated as backend evolves)
// =============================================================================

export async function loadFile(fileName: string, authHeaders: Record<string, string> = {}) {
  // This endpoint might be deprecated in your new structure
  // For now, use file preview as a replacement
  return getUnifiedFilePreview({ filename: fileName, page: 0, page_size: 20 }, authHeaders);
}

export async function getDataFrame(pageIdx: number, authHeaders: Record<string, string> = {}) {
  // This endpoint might be replaced by workspace node operations
  // For now, keeping for backward compatibility
  return apiRequest(`${API_BASE}/dataframe`, { method: 'GET', headers: authHeaders, params: { page_idx: pageIdx } });
}

export async function getWorkspaceGraph(
  workspaceId: string,
  authHeaders: Record<string, string> = {}
) {
  return getJson(`${API_BASE}/workspaces/${workspaceId}/graph`, authHeaders);
}

export async function saveWorkspace(
  workspaceId: string,
  authHeaders: Record<string, string> = {}
) {
  return apiRequest(`${API_BASE}/workspaces/${workspaceId}/save`, { method: 'POST', headers: authHeaders });
}

export async function saveWorkspaceAs(
  workspaceId: string,
  filename: string,
  authHeaders: Record<string, string> = {}
) {
  return apiRequest(`${API_BASE}/workspaces/${workspaceId}/save-as`, { method: 'POST', headers: authHeaders, params: { filename } });
}

export async function downloadWorkspace(
  workspaceId: string,
  authHeaders: Record<string, string> = {}
) {
  return apiRequest(`${API_BASE}/workspaces/${workspaceId}/download`, { method: 'GET', headers: authHeaders, expectBlob: true }) as Promise<Blob>;
}

export async function updateWorkspaceName(
  workspaceId: string,
  newName: string,
  authHeaders: Record<string, string> = {}
) {
  return apiRequest(`${API_BASE}/workspaces/${workspaceId}/name`, { method: 'PUT', headers: authHeaders, params: { new_name: newName } });
}

export async function deleteWorkspaceNode(
  workspaceId: string,
  nodeId: string,
  authHeaders: Record<string, string> = {}
) {
  return deleteReq(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}`, authHeaders);
}

// =============================================================================
// CURRENT WORKSPACE MANAGEMENT API
// =============================================================================

export const getCurrentWorkspace = async (headers: Record<string, string>) => {
  const data = await getJson(`${API_BASE}/workspaces/current`, headers) as any;
  return data.current_workspace_id || null;
};

export const setCurrentWorkspace = async (workspaceId: string | null, headers: Record<string, string>) => {
  const params = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
  return apiRequest(`${API_BASE}/workspaces/current${params}`, { method: 'POST', headers });
};

// =============================================================================
// NODE CONVERSION API
// =============================================================================

export type ConversionTarget = 'docdataframe' | 'dataframe' | 'doclazyframe' | 'lazyframe';

export async function convertNode(
  workspaceId: string,
  nodeId: string,
  target: ConversionTarget,
  documentColumn?: string,
  authHeaders: Record<string, string> = {}
) {
  return apiRequest(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/convert`, {
    method: 'POST',
    headers: authHeaders,
    params: {
      target,
      ...(documentColumn && { document_column: documentColumn }),
    },
  });
}

// Legacy functions for backward compatibility
export async function convertToDocDataFrame(
  workspaceId: string,
  nodeId: string,
  documentColumn: string,
  authHeaders: Record<string, string> = {}
) {
  return convertNode(workspaceId, nodeId, 'docdataframe', documentColumn, authHeaders);
}

export async function convertToDataFrame(
  workspaceId: string,
  nodeId: string,
  authHeaders: Record<string, string> = {}
) {
  return convertNode(workspaceId, nodeId, 'dataframe', undefined, authHeaders);
}

export async function convertToDocLazyFrame(
  workspaceId: string,
  nodeId: string,
  documentColumn: string,
  authHeaders: Record<string, string> = {}
) {
  return convertNode(workspaceId, nodeId, 'doclazyframe', documentColumn, authHeaders);
}

export async function convertToLazyFrame(
  workspaceId: string,
  nodeId: string,
  authHeaders: Record<string, string> = {}
) {
  return convertNode(workspaceId, nodeId, 'lazyframe', undefined, authHeaders);
}

export async function resetDocumentColumn(
  workspaceId: string,
  nodeId: string,
  documentColumn?: string,
  authHeaders: Record<string, string> = {}
) {
  return apiRequest(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/reset-document`, {
    method: 'POST',
    headers: authHeaders,
    params: documentColumn ? { document_column: documentColumn } : {},
  });
}

export interface JoinNodesRequest {
  left_node_id: string;
  right_node_id: string;
  left_on: string;
  right_on: string;
  how?: 'inner' | 'left' | 'right' | 'full' | 'semi' | 'anti' | 'cross';
  new_node_name?: string;
}

export async function joinNodes(
  workspaceId: string,
  request: JoinNodesRequest,
  authHeaders: Record<string, string> = {}
) {
  return apiRequest(`${API_BASE}/workspaces/${workspaceId}/nodes/join`, {
    method: 'POST',
    headers: authHeaders,
    params: request,
  });
}

export interface CastNodeRequest {
  column: string;
  target_type: string;
  format?: string; // Optional datetime format
}

export async function castNode(
  workspaceId: string,
  nodeId: string,
  request: CastNodeRequest,
  authHeaders: Record<string, string> = {}
) {
  return postJson(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/cast`, request, authHeaders);
}

export async function getNodeSchema(
  workspaceId: string,
  nodeId: string,
  authHeaders: Record<string, string> = {}
): Promise<Record<string, string>> {
  const data = await getJson(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}`, authHeaders) as any;
  return data.schema || {};
}

export interface FilterCondition {
  column: string;
  operator: 'eq' | 'gte' | 'lte' | 'contains' | 'startswith' | 'endswith' | 'is_null' | 'between';
  value: string | number | boolean | Date | { start: Date | null, end: Date | null } | { start: string | null, end: string | null } | null;
  negate?: boolean; // apply .not_() on the predicate
  regex?: boolean; // only applicable to string operators; default true for contains
}

export interface FilterRequest {
  conditions: FilterCondition[];
  logic?: string;
  new_node_name?: string;
}

export async function filterNode(
  workspaceId: string,
  nodeId: string,
  request: FilterRequest,
  authHeaders: Record<string, string> = {}
) {
  return postJson(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/filter`, request, authHeaders);
}

export interface SliceRequest {
  start_row?: number;
  end_row?: number;
  columns?: string[];
  new_node_name?: string;
}

export async function sliceNode(
  workspaceId: string,
  nodeId: string,
  request: SliceRequest,
  authHeaders: Record<string, string> = {}
) {
  return postJson(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/slice`, request, authHeaders);
}

export interface ConcordanceRequest {
  column: string;
  search_word: string;
  num_left_tokens?: number;
  num_right_tokens?: number;
  regex?: boolean;
  case_sensitive?: boolean;
  show_metadata?: boolean;
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface MultiNodeConcordanceRequest {
  node_ids: string[];
  node_columns: Record<string, string>;  // node_id -> column_name mapping
  search_word: string;
  num_left_tokens?: number;
  num_right_tokens?: number;
  regex?: boolean;
  case_sensitive?: boolean;
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  combined?: boolean; // request combined concatenated view in addition to per-node results
  show_metadata?: boolean;
}

export interface MultiNodeConcordanceResponse {
  success: boolean;
  message: string;
  data: Record<string, {
    data: any[];
    columns: string[];
    total_matches: number;
    pagination: {
      page: number;
      page_size: number;
      total_pages: number;
      has_next: boolean;
      has_prev: boolean;
    };
    sorting: {
      sort_by?: string;
      sort_order: string;
    };
  }>;
}

export interface ConcordanceDetachRequest {
  node_id: string;
  column: string;
  search_word: string;
  num_left_tokens?: number;
  num_right_tokens?: number;
  regex?: boolean;
  case_sensitive?: boolean;
  new_node_name?: string;
}

export interface ConcordanceDetachResponse {
  success: boolean;
  message: string;
  new_node_id: string;
  new_node_name: string;
  total_rows: number;
  concordance_matches: number;
}

// Quotation API types
export interface QuotationRequest {
  column: string;
  show_metadata?: boolean;
  page?: number;
  page_size?: number;
  sort_by?: string | null;
  sort_order?: 'asc' | 'desc';
}

export interface QuotationDetachRequest {
  node_id: string;
  column: string;
  new_node_name?: string;
}

export interface FrequencyAnalysisRequest {
  time_column: string;
  group_by_columns?: string[] | null;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  sort_by_time: boolean;
}

export async function concordanceSearch(
  workspaceId: string,
  nodeId: string,
  request: ConcordanceRequest,
  authHeaders: Record<string, string> = {}
) {
  return postJson(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/concordance`, request, authHeaders);
}

export async function multiNodeConcordanceSearch(
  workspaceId: string,
  request: MultiNodeConcordanceRequest,
  authHeaders: Record<string, string> = {}
): Promise<MultiNodeConcordanceResponse> {
  return postJson(`${API_BASE}/workspaces/${workspaceId}/concordance/multi-node`, request, authHeaders) as Promise<MultiNodeConcordanceResponse>;
}

export async function getConcordanceDetail(
  workspaceId: string,
  nodeId: string,
  documentIdx: number,
  textColumn: string,
  authHeaders: Record<string, string> = {}
) {
  return apiRequest(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/concordance/${documentIdx}`, {
    method: 'GET',
    headers: authHeaders,
    params: { text_column: textColumn },
  });
}

export async function detachConcordance(
  workspaceId: string,
  nodeId: string,
  request: ConcordanceDetachRequest,
  authHeaders: Record<string, string> = {}
): Promise<ConcordanceDetachResponse> {
  return postJson(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/concordance/detach`, request, authHeaders) as Promise<ConcordanceDetachResponse>;
}

export async function quotationSearch(
  workspaceId: string,
  nodeId: string,
  request: QuotationRequest,
  headers: Record<string, string> = {}
): Promise<any> {
  return postJson(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/quotation`, request, headers);
}

export async function detachQuotation(
  workspaceId: string,
  nodeId: string,
  request: QuotationDetachRequest,
  headers: Record<string, string> = {}
): Promise<any> {
  return postJson(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/quotation/detach`, request, headers);
}

export async function frequencyAnalysis(
  workspaceId: string,
  nodeId: string,
  request: FrequencyAnalysisRequest,
  authHeaders: Record<string, string> = {}
) {
  return postJson(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/frequency-analysis`, request, authHeaders);
}

// Token Frequency Analysis Types and API

export interface TokenFrequencyRequest {
  node_ids: string[];
  node_columns: Record<string, string>; // Maps node_id -> column_name
  stop_words?: string[] | null;
  limit?: number;
}

export interface TokenFrequencyData {
  token: string;
  frequency: number;
}

export interface TokenStatisticsData {
  token: string;
  freq_corpus_0: number;           // O1 - observed frequency in corpus 1
  freq_corpus_1: number;           // O2 - observed frequency in corpus 2
  expected_0: number;              // Expected frequency in corpus 1
  expected_1: number;              // Expected frequency in corpus 2
  corpus_0_total: number;          // Total tokens in corpus 1
  corpus_1_total: number;          // Total tokens in corpus 2
  percent_corpus_0: number;        // %1 - percentage in corpus 1
  percent_corpus_1: number;        // %2 - percentage in corpus 2
  percent_diff: number;            // %DIFF - percentage difference
  log_likelihood_llv: number;      // LL - log likelihood G2 statistic
  bayes_factor_bic: number;        // Bayes - Bayes factor (BIC)
  effect_size_ell: number;         // ELL - effect size for log likelihood
  relative_risk: number | null;    // RRisk - relative risk ratio (can be null when infinite)
  log_ratio: number | null;        // LogRatio - log of relative frequencies (can be null)
  odds_ratio: number | null;       // OddsRatio - odds ratio (can be null when infinite)
  significance: string;            // Significance level indicator
}

export interface TokenFrequencyResponse {
  success: boolean;
  message: string;
  data?: Record<string, TokenFrequencyData[]> | null; // Maps node_name -> frequency data
  statistics?: TokenStatisticsData[] | null; // Statistical measures (only when comparing 2 nodes)
}

export async function calculateTokenFrequencies(
  workspaceId: string,
  request: TokenFrequencyRequest,
  authHeaders: Record<string, string> = {}
): Promise<TokenFrequencyResponse> {
  return postJson(`${API_BASE}/workspaces/${workspaceId}/token-frequencies`, request, authHeaders) as Promise<TokenFrequencyResponse>;
}

export async function getDefaultStopWords(
  authHeaders: Record<string, string> = {}
): Promise<{ success: boolean; message: string; data: string[] }> {
  return getJson(`${API_BASE}/text/default-stop-words`, authHeaders) as Promise<{ success: boolean; message: string; data: string[] }>;
}

// Topic Modeling Types & API

export interface TopicModelingRequest {
  node_ids: string[]; // up to 2
  node_columns?: Record<string, string>;
  min_topic_size?: number;
  use_ctfidf?: boolean;
}

export interface TopicModelingTopic {
  id: number;
  label: string;
  size: number[]; // per-corpus sizes
  total_size: number;
  x: number;
  y: number;
}

export interface TopicModelingData {
  topics: TopicModelingTopic[];
  corpus_sizes: number[];
  per_corpus_topic_counts?: Record<string, number>[]; // list of dicts (topic_id -> count)
  meta: Record<string, any>;
}

export interface TopicModelingResponse {
  success: boolean;
  message: string;
  data?: TopicModelingData | null;
}

export async function runTopicModeling(
  workspaceId: string,
  request: TopicModelingRequest,
  authHeaders: Record<string, string> = {}
): Promise<TopicModelingResponse> {
  return postJson(`${API_BASE}/workspaces/${workspaceId}/topic-modeling`, request, authHeaders) as Promise<TopicModelingResponse>;
}
