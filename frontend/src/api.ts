import axios from 'axios';

// Determine API base URL based on current hostname and environment
const getApiBase = () => {
  const hostname = window.location.hostname;
  const origin = window.location.origin;
  
  console.log('API Detection:', {
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
  
  // Default fallback
  return process.env.NODE_ENV === 'production' 
    ? `${origin}/api`
    : 'http://localhost:8001/api';
};

const API_BASE = getApiBase();

console.log('Final API_BASE:', API_BASE);

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

// =============================================================================
// AUTHENTICATION API
// =============================================================================

export async function googleAuth(idToken: string): Promise<GoogleAuthResponse> {
  const res = await axios.post(`${API_BASE}/auth/google`, {
    id_token: idToken
  });
  return res.data;
}

export async function getAuthStatus(authHeaders: Record<string, string> = {}): Promise<UserMeResponse> {
  const res = await axios.get(`${API_BASE}/auth/status`, {
    headers: authHeaders
  });
  return res.data;
}

export async function logout(authHeaders: Record<string, string> = {}) {
  const res = await axios.post(`${API_BASE}/auth/logout`, {}, {
    headers: authHeaders
  });
  return res.data;
}

// =============================================================================
// FILE MANAGEMENT API
// =============================================================================

export async function getFiles(authHeaders: Record<string, string> = {}): Promise<FileListResponse> {
  const res = await axios.get(`${API_BASE}/files/`, {
    headers: authHeaders
  });
  return res.data;
}

export async function uploadFile(file: File, authHeaders: Record<string, string> = {}) {
  const formData = new FormData();
  formData.append('file', file);
  
  const res = await axios.post(`${API_BASE}/files/upload`, formData, {
    headers: {
      ...authHeaders,
      'Content-Type': 'multipart/form-data'
    }
  });
  return res.data;
}

export async function downloadFile(fileName: string, authHeaders: Record<string, string> = {}) {
  const res = await axios.get(`${API_BASE}/files/${encodeURIComponent(fileName)}`, {
    responseType: 'blob',
    headers: authHeaders
  });
  return res.data;
}

export async function getFilePreview(
  fileName: string,
  authHeaders: Record<string, string> = {},
  opts?: { page?: number; pageSize?: number }
) {
  const res = await axios.get(`${API_BASE}/files/${encodeURIComponent(fileName)}/preview`, {
    headers: authHeaders,
    params: {
      page: opts?.page ?? 0,
      page_size: opts?.pageSize ?? 20,
    }
  });
  return res.data;
}

export async function getFileInfo(fileName: string, authHeaders: Record<string, string> = {}) {
  const res = await axios.get(`${API_BASE}/files/${encodeURIComponent(fileName)}/info`, {
    headers: authHeaders
  });
  return res.data;
}

export async function deleteFile(fileName: string, authHeaders: Record<string, string> = {}) {
  const res = await axios.delete(`${API_BASE}/files/${encodeURIComponent(fileName)}`, {
    headers: authHeaders
  });
  return res.data;
}

// =============================================================================
// WORKSPACE MANAGEMENT API (Future Use)
// =============================================================================

export async function getWorkspaces(authHeaders: Record<string, string> = {}) {
  const res = await axios.get(`${API_BASE}/workspaces/`, { 
    headers: authHeaders 
  });
  return res.data.workspaces || [];
}

export async function createWorkspace(
  name: string, 
  description: string = '', 
  authHeaders: Record<string, string> = {},
  initialDataFile?: string
) {
  const requestBody: any = {
    name,
    description
  };
  
  if (initialDataFile) {
    requestBody.initial_data_file = initialDataFile;
  }
  
  const res = await axios.post(`${API_BASE}/workspaces/`, requestBody, { 
    headers: authHeaders 
  });
  return res.data;
}

export async function getWorkspaceInfo(workspaceId: string, authHeaders: Record<string, string> = {}) {
  const res = await axios.get(`${API_BASE}/workspaces/${workspaceId}`, { 
    headers: authHeaders 
  });
  return res.data;
}

export async function deleteWorkspace(workspaceId: string, authHeaders: Record<string, string> = {}) {
  const res = await axios.delete(`${API_BASE}/workspaces/${workspaceId}`, { 
    headers: authHeaders 
  });
  return res.data;
}

export async function getWorkspaceNodes(workspaceId: string, authHeaders: Record<string, string> = {}) {
  const res = await axios.get(`${API_BASE}/workspaces/${workspaceId}/nodes`, { 
    headers: authHeaders 
  });
  return res.data.nodes || [];
}

export async function createNodeFromFile(
  workspaceId: string, 
  filename: string, 
  nodeName?: string, 
  authHeaders: Record<string, string> = {}
) {
  const res = await axios.post(`${API_BASE}/workspaces/${workspaceId}/nodes`, null, {
    params: {
      filename,
      node_name: nodeName
    },
    headers: authHeaders 
  });
  return res.data;
}

export async function getNodeInfo(
  workspaceId: string, 
  nodeId: string, 
  authHeaders: Record<string, string> = {}
) {
  const res = await axios.get(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}`, { 
    headers: authHeaders 
  });
  return res.data;
}

export async function getNodeData(
  workspaceId: string, 
  nodeId: string, 
  page: number = 0, 
  pageSize: number = 50, 
  authHeaders: Record<string, string> = {}
) {
  const res = await axios.get(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/data`, { 
    params: { page, page_size: pageSize },
    headers: authHeaders 
  });
  return res.data;
}

export async function getNodeShape(
  workspaceId: string, 
  nodeId: string, 
  authHeaders: Record<string, string> = {}
) {
  const res = await axios.get(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/shape`, { 
    headers: authHeaders 
  });
  return res.data;
}

export async function deleteNode(
  workspaceId: string, 
  nodeId: string, 
  authHeaders: Record<string, string> = {}
) {
  const res = await axios.delete(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}`, { 
    headers: authHeaders 
  });
  return res.data;
}

export async function renameNode(
  workspaceId: string,
  nodeId: string,
  newName: string,
  authHeaders: Record<string, string> = {}
) {
  // RESTful endpoint only
  const res = await axios.put(
    `${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/name`,
    null,
    {
      headers: authHeaders,
      params: { new_name: newName },
    }
  );
  return res.data;
}

// =============================================================================
// USER MANAGEMENT API
// =============================================================================

export async function getUserFolders(authHeaders: Record<string, string> = {}) {
  const res = await axios.get(`${API_BASE}/user/folders`, {
    headers: authHeaders
  });
  return res.data;
}

export async function getUserStorage(authHeaders: Record<string, string> = {}) {
  const res = await axios.get(`${API_BASE}/user/storage`, {
    headers: authHeaders
  });
  return res.data;
}

// =============================================================================
// LEGACY COMPATIBILITY (to be updated as backend evolves)
// =============================================================================

export async function loadFile(fileName: string, authHeaders: Record<string, string> = {}) {
  // This endpoint might be deprecated in your new structure
  // For now, use file preview as a replacement
  return getFilePreview(fileName, authHeaders);
}

export async function getDataFrame(pageIdx: number, authHeaders: Record<string, string> = {}) {
  // This endpoint might be replaced by workspace node operations
  // For now, keeping for backward compatibility
  const res = await axios.get(`${API_BASE}/dataframe`, { 
    params: { page_idx: pageIdx },
    headers: authHeaders
  });
  return res.data;
}

export async function getWorkspaceGraph(
  workspaceId: string,
  authHeaders: Record<string, string> = {}
) {
  const res = await axios.get(`${API_BASE}/workspaces/${workspaceId}/graph`, {
    headers: authHeaders
  });
  return res.data;
}

export async function saveWorkspace(
  workspaceId: string,
  authHeaders: Record<string, string> = {}
) {
  const res = await axios.post(`${API_BASE}/workspaces/${workspaceId}/save`, null, {
    headers: authHeaders
  });
  return res.data;
}

export async function saveWorkspaceAs(
  workspaceId: string,
  filename: string,
  authHeaders: Record<string, string> = {}
) {
  const res = await axios.post(`${API_BASE}/workspaces/${workspaceId}/save-as`, null, {
    params: { filename },
    headers: authHeaders
  });
  return res.data;
}

export async function updateWorkspaceName(
  workspaceId: string,
  newName: string,
  authHeaders: Record<string, string> = {}
) {
  const res = await axios.put(`${API_BASE}/workspaces/${workspaceId}/name`, null, {
    params: { new_name: newName },
    headers: authHeaders
  });
  return res.data;
}

export async function deleteWorkspaceNode(
  workspaceId: string,
  nodeId: string,
  authHeaders: Record<string, string> = {}
) {
  const res = await axios.delete(`${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}`, {
    headers: authHeaders
  });
  return res.data;
}

// =============================================================================
// CURRENT WORKSPACE MANAGEMENT API
// =============================================================================

export const getCurrentWorkspace = async (headers: Record<string, string>) => {
  const response = await axios.get(`${API_BASE}/workspaces/current`, { headers });
  return response.data.current_workspace_id || null;
};

export const setCurrentWorkspace = async (workspaceId: string | null, headers: Record<string, string>) => {
  const params = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
  const response = await axios.post(`${API_BASE}/workspaces/current${params}`, 
    {}, 
    { headers }
  );
  return response.data;
};

// =============================================================================
// NODE CONVERSION API
// =============================================================================

export async function convertToDocDataFrame(
  workspaceId: string,
  nodeId: string,
  documentColumn: string,
  authHeaders: Record<string, string> = {}
) {
  const res = await axios.post(
    `${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/convert/to-docdataframe`,
    null,
    {
      params: { document_column: documentColumn },
      headers: authHeaders
    }
  );
  return res.data;
}

export async function convertToDataFrame(
  workspaceId: string,
  nodeId: string,
  authHeaders: Record<string, string> = {}
) {
  const res = await axios.post(
    `${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/convert/to-dataframe`,
    null,
    {
      headers: authHeaders
    }
  );
  return res.data;
}

export async function convertToDocLazyFrame(
  workspaceId: string,
  nodeId: string,
  documentColumn: string,
  authHeaders: Record<string, string> = {}
) {
  const res = await axios.post(
    `${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/convert/to-doclazyframe`,
    null,
    {
      params: { document_column: documentColumn },
      headers: authHeaders
    }
  );
  return res.data;
}

export async function convertToLazyFrame(
  workspaceId: string,
  nodeId: string,
  authHeaders: Record<string, string> = {}
) {
  const res = await axios.post(
    `${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/convert/to-lazyframe`,
    null,
    {
      headers: authHeaders
    }
  );
  return res.data;
}

export async function resetDocumentColumn(
  workspaceId: string,
  nodeId: string,
  documentColumn?: string,
  authHeaders: Record<string, string> = {}
) {
  const res = await axios.post(
    `${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/reset-document`,
    null,
    {
      params: documentColumn ? { document_column: documentColumn } : {},
      headers: authHeaders,
    }
  );
  return res.data;
}

export interface JoinNodesRequest {
  left_node_id: string;
  right_node_id: string;
  left_on: string;
  right_on: string;
  how?: 'inner' | 'left' | 'right' | 'outer';
  new_node_name?: string;
}

export async function joinNodes(
  workspaceId: string,
  request: JoinNodesRequest,
  authHeaders: Record<string, string> = {}
) {
  const res = await axios.post(
    `${API_BASE}/workspaces/${workspaceId}/nodes/join`,
    null,
    {
      params: request,
      headers: authHeaders
    }
  );
  return res.data;
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
  const res = await axios.post(
    `${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/cast`,
    request,
    {
      headers: authHeaders
    }
  );
  return res.data;
}

export async function getNodeSchema(
  workspaceId: string,
  nodeId: string,
  authHeaders: Record<string, string> = {}
): Promise<Record<string, string>> {
  const res = await axios.get(
    `${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}`,
    {
      headers: authHeaders
    }
  );
  
  // Extract schema from the node info response
  // Backend returns node.info(json=True) which includes a schema field with js_type compatible values
  return res.data.schema || {};
}

export interface FilterCondition {
  column: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'startswith' | 'endswith' | 'is_null' | 'is_not_null';
  value: string | number | boolean;
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
  const res = await axios.post(
    `${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/filter`,
    request,
    {
      headers: authHeaders
    }
  );
  return res.data;
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
  const res = await axios.post(
    `${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/slice`,
    request,
    {
      headers: authHeaders
    }
  );
  return res.data;
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
  const res = await axios.post(
    `${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/concordance`,
    request,
    {
      headers: authHeaders
    }
  );
  return res.data;
}

export async function multiNodeConcordanceSearch(
  workspaceId: string,
  request: MultiNodeConcordanceRequest,
  authHeaders: Record<string, string> = {}
): Promise<MultiNodeConcordanceResponse> {
  const res = await axios.post(
    `${API_BASE}/workspaces/${workspaceId}/concordance/multi-node`,
    request,
    {
      headers: authHeaders
    }
  );
  return res.data;
}

export async function getConcordanceDetail(
  workspaceId: string,
  nodeId: string,
  documentIdx: number,
  textColumn: string,
  authHeaders: Record<string, string> = {}
) {
  const res = await axios.get(
    `${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/concordance/${documentIdx}`,
    {
      params: { text_column: textColumn },
      headers: authHeaders
    }
  );
  return res.data;
}

export async function detachConcordance(
  workspaceId: string,
  nodeId: string,
  request: ConcordanceDetachRequest,
  authHeaders: Record<string, string> = {}
): Promise<ConcordanceDetachResponse> {
  const res = await axios.post(
    `${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/concordance/detach`,
    request,
    {
      headers: authHeaders
    }
  );
  return res.data;
}

export async function frequencyAnalysis(
  workspaceId: string,
  nodeId: string,
  request: FrequencyAnalysisRequest,
  authHeaders: Record<string, string> = {}
) {
  const res = await axios.post(
    `${API_BASE}/workspaces/${workspaceId}/nodes/${nodeId}/frequency-analysis`,
    request,
    {
      headers: authHeaders
    }
  );
  return res.data;
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
  const res = await axios.post(
    `${API_BASE}/workspaces/${workspaceId}/token-frequencies`,
    request,
    {
      headers: authHeaders
    }
  );
  return res.data;
}

export async function getDefaultStopWords(
  authHeaders: Record<string, string> = {}
): Promise<{ success: boolean; message: string; data: string[] }> {
  const res = await axios.get(
    `${API_BASE}/text/default-stop-words`,
    {
      headers: authHeaders
    }
  );
  return res.data;
}
