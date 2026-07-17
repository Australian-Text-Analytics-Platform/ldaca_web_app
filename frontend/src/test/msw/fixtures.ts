import { tableFromArrays, tableToIPC } from 'apache-arrow';
import type {
  Analysis,
  DataPortalSearchResource,
  FileResource,
  ProviderCredentialSummary,
  SampleCatalogueResource,
  SessionResponse,
  Tab,
  TokenizerModelResource,
  WorkspaceNodeInfo,
  WorkspaceResource,
} from '@/api';

const TEST_DATE = '2026-01-01T00:00:00Z';

/** Builds the canonical cookie-session bootstrap response used by shared tests. */
export const sessionResponse = (overrides: Partial<SessionResponse> = {}): SessionResponse => ({
  authenticated: false,
  csrf_token: 'test-csrf-token',
  mode: 'single_user',
  providers: [],
  user: null,
  ...overrides,
});

export const workspaceResponse = (
  overrides: Partial<WorkspaceResource> = {},
): WorkspaceResource => ({
  id: 'workspace-1',
  name: 'Workspace',
  description: '',
  created_at: TEST_DATE,
  modified_at: TEST_DATE,
  revision: 1,
  runtime_state: 'open',
  total_nodes: 0,
  root_nodes: 0,
  leaf_nodes: 0,
  ...overrides,
});

export const tabResponse = (overrides: Partial<Tab> = {}): Tab => ({
  id: 'tab-1',
  name: 'Analysis',
  kind: 'token_frequency',
  analysis_id: null,
  created_at: TEST_DATE,
  modified_at: TEST_DATE,
  revision: 1,
  ...overrides,
});

/** Minimal canonical Analysis used by status and tab tests. */
export const analysisResponse = (overrides: Partial<Analysis> = {}): Analysis => ({
  id: 'analysis-1',
  parent_analysis_id: null,
  state: 'succeeded',
  cancellation_requested_at: null,
  created_at: TEST_DATE,
  started_at: TEST_DATE,
  finished_at: TEST_DATE,
  revision: 1,
  progress: { fraction: 1, message: 'Complete' },
  error: null,
  integrity: { status: 'valid' },
  request: {
    kind: 'token_frequency',
    node_ids: ['node-1'],
    node_columns: { 'node-1': 'text' },
    node_tokenizer_models: { 'node-1': 'native:plain_words_en' },
    stop_words: [],
    token_limit: 20,
  },
  ...overrides,
});

export const nodeResponse = (overrides: Partial<WorkspaceNodeInfo> = {}): WorkspaceNodeInfo => ({
  id: 'node-1',
  name: 'Text',
  derivation_description: 'Source file',
  provenance: { type: 'source', file_path: 'text.csv' },
  parent_ids: [],
  child_ids: [],
  shape: [1, 1],
  ...overrides,
});

/** Builds the canonical Arrow row stream used by shared node-table handlers. */
export const nodeRowsArrowStream = (): Uint8Array =>
  tableToIPC(
    tableFromArrays({ text: ['This is an English sample document for language detection.'] }),
    'stream',
  );

export const fileResponse = (overrides: Partial<FileResource> = {}): FileResource => ({
  path: 'text.csv',
  name: 'text.csv',
  type: 'file',
  file_type: 'csv',
  size_bytes: 64,
  modified_at: 1,
  preview_available: true,
  ...overrides,
});

export const dataPortalResponse = (
  overrides: Partial<DataPortalSearchResource> = {},
): DataPortalSearchResource => ({
  items: [],
  page: 1,
  page_size: 20,
  total: 0,
  ...overrides,
});

export const sampleCatalogueResponse = (
  overrides: Partial<SampleCatalogueResource> = {},
): SampleCatalogueResource => ({
  collections: [],
  schema_version: 1,
  ...overrides,
});

export const providerCredentialResponse = (
  overrides: Partial<ProviderCredentialSummary> = {},
): ProviderCredentialSummary => ({
  annotation: { anthropic: false, google: false, openai: false, openrouter: false },
  data_portal: { deployment_configured: false, user_configured: false },
  ...overrides,
});

export const tokenizerModelsResponse = (
  overrides: TokenizerModelResource[] = [],
): TokenizerModelResource[] => overrides;
