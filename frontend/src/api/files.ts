import { get, post, del, httpRequest } from './http';

const LDACA_API_TOKEN_HEADER = 'X-LDACA-API-Token';

function withLdacaApiToken(
  headers: Record<string, string> = {},
  token?: string | null,
): Record<string, string> {
  const trimmed = token?.trim();
  return trimmed ? { ...headers, [LDACA_API_TOKEN_HEADER]: trimmed } : headers;
}

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

export interface CreateFolderResponse {
  message: string;
  path: string;
}

export interface MoveFileResponse {
  message: string;
  path: string;
}

export interface UnifiedFilePreviewRequest {
  filename: string;
  page?: number;
  page_size?: number;
  payload?: { sheet_name?: string };
}

export interface FilePreviewResponse {
  preview: Record<string, unknown>[];
  columns: string[];
  total_rows: number;
  file_type: string | null;
  sheet_names: string[] | null;
  supported_types: string[];
  selected_sheet: string | null;
}

export interface LdacaImportStartResponse {
  state: 'running';
  message: string;
  metadata: {
    task_id: string;
  };
}

export type LdacaSearchMethod = 'keyword' | 'identifier';

export interface LdacaSearchRequest {
  method: LdacaSearchMethod;
  query: string;
  limit?: number;
  offset?: number;
}

export interface LdacaSearchResult {
  id: string;
  crate_id?: string | null;
  title: string;
  description?: string | null;
  types: string[];
  license?: string | null;
  importable: boolean;
  access?: Record<string, unknown> | null;
  collections?: string[];
  file_formats?: string[];
  stats: Record<string, unknown>;
}

export interface LdacaSearchResponse {
  state: 'successful';
  data: LdacaSearchResult[];
  message: string;
}

export type SampleDataCollectionStatus = 'bundled' | 'downloaded' | 'partial' | 'not_downloaded';

export interface SampleDataFileEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface SampleDataCollection {
  id: string;
  name: string;
  description: string;
  language: string;
  bundled: boolean;
  total_size_bytes: number;
  recommended_for: string[];
  files: SampleDataFileEntry[];
  status: SampleDataCollectionStatus;
}

export interface SampleDataCatalogueResponse {
  schema_version: number;
  collections: SampleDataCollection[];
}

export interface ImportSampleDataResponse {
  status: string;
  removed_existing: boolean;
  file_count: number;
  bytes_copied: number;
  message: string;
  sample_dir: string | null;
  remote_download_started: boolean;
}

// ── Demo-snapshot catalogue ─────────────────────────────────────────────
//
// Parallel to the sample-data catalogue. Each entry is a single
// ``.ldaca-snapshot`` bundle hosted under ``demo_snapshots/`` in the
// sample-data repo. The frontend renders these as a second tab in the
// import dialog; importing writes the bundle into the user's snapshot
// folder so each tool's Load dialog discovers it automatically.

export type DemoSnapshotStatus = 'downloaded' | 'not_downloaded' | 'conflict';

export interface DemoSnapshotEntry {
  id: string;
  filename: string;
  path: string;
  tool: string;
  name: string;
  description: string;
  size: number;
  sha256: string;
  tool_version?: string | null;
  recommended_dataset?: string | null;
  status: DemoSnapshotStatus;
}

export interface DemoSnapshotsCatalogueResponse {
  schema_version: number;
  snapshots: DemoSnapshotEntry[];
}

export type DemoSnapshotImportStatus =
  | 'imported'
  | 'replaced'
  | 'skipped_existing'
  | 'skipped_conflict'
  | 'failed';

export interface DemoSnapshotImportResult {
  id: string;
  filename: string;
  status: DemoSnapshotImportStatus;
  message?: string | null;
}

export interface ImportDemoSnapshotsResponse {
  results: DemoSnapshotImportResult[];
  snapshot_dir: string;
}

export const filesApi = {
  list: (headers: Record<string, string> = {}) => get<FileTreeNode[]>('/files/', headers),

  raw: (path: string, headers: Record<string, string> = {}) =>
    get<string>('/files/raw', headers, { path }),

  createFolder: (parentPath: string, name: string, headers: Record<string, string> = {}) =>
    post<CreateFolderResponse>('/files/folders', { parent_path: parentPath, name }, headers),

  moveFile: (
    sourcePath: string,
    targetDirectoryPath: string,
    headers: Record<string, string> = {},
  ) =>
    post<MoveFileResponse>(
      '/files/move',
      { source_path: sourcePath, target_directory_path: targetDirectoryPath },
      headers,
    ),

  upload: (file: File, headers: Record<string, string> = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    return httpRequest<Record<string, unknown>>('/files/upload', {
      method: 'POST',
      formData,
      headers,
    });
  },

  download: (fileName: string, headers: Record<string, string> = {}) =>
    httpRequest<Blob>(`/files/${encodeURIComponent(fileName)}`, {
      method: 'GET',
      headers,
      expectBlob: true,
    }),

  preview: (body: UnifiedFilePreviewRequest, headers: Record<string, string> = {}) =>
    post<FilePreviewResponse>('/files/preview', body, headers),

  delete: (fileName: string, headers: Record<string, string> = {}) =>
    del<Record<string, unknown>>(`/files/${encodeURIComponent(fileName)}`, headers),

  getSampleDataCatalogue: (headers: Record<string, string> = {}) =>
    get<SampleDataCatalogueResponse>('/files/sample-data/catalogue', headers),

  getSampleDataReadme: (path: string, headers: Record<string, string> = {}) =>
    get<string>('/files/sample-data/readme', headers, { path }),

  importSampleData: (collectionIds: string[] = [], headers: Record<string, string> = {}) =>
    post<ImportSampleDataResponse>(
      '/files/import-sample-data',
      { collection_ids: collectionIds },
      headers,
    ),

  getDemoSnapshotsCatalogue: (headers: Record<string, string> = {}) =>
    get<DemoSnapshotsCatalogueResponse>('/files/demo-snapshots/catalogue', headers),

  importDemoSnapshots: (
    snapshotIds: string[] = [],
    replaceIds: string[] = [],
    headers: Record<string, string> = {},
  ) =>
    post<ImportDemoSnapshotsResponse>(
      '/files/import-demo-snapshots',
      { snapshot_ids: snapshotIds, replace_ids: replaceIds },
      headers,
    ),

  getLdacaFeatured: (headers: Record<string, string> = {}, ldacaApiToken?: string | null) =>
    get<LdacaSearchResponse>('/files/ldaca/featured', withLdacaApiToken(headers, ldacaApiToken)),

  searchLdaca: (
    request: LdacaSearchRequest,
    headers: Record<string, string> = {},
    ldacaApiToken?: string | null,
  ) =>
    post<LdacaSearchResponse>(
      '/files/ldaca/search',
      request,
      withLdacaApiToken(headers, ldacaApiToken),
    ),

  importLdaca: (url: string, headers: Record<string, string> = {}, ldacaApiToken?: string | null) =>
    post<LdacaImportStartResponse>(
      '/files/import-ldaca',
      { url },
      withLdacaApiToken(headers, ldacaApiToken),
    ),

  /** Clear a single background task tracked under /files/tasks. */
  clearTasks: (
    payload: { task_type?: string; task_id?: string } = {},
    headers: Record<string, string> = {},
  ) => post<Record<string, unknown>>('/files/tasks/clear', payload, headers),
};
