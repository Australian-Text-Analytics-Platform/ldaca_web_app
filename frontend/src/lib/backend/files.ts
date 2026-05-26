import {
  clearFilesTasksApiFilesTasksClearPost,
  createFolderApiFilesFoldersPost,
  deleteFileApiFilesFilenameDelete,
  downloadFileApiFilesFilenameGet,
  getDemoSnapshotsCatalogueApiFilesDemoSnapshotsCatalogueGet,
  getRawFileApiFilesRawGet,
  getSampleDataCatalogueApiFilesSampleDataCatalogueGet,
  getSampleDataReadmeApiFilesSampleDataReadmeGet,
  getUserFilesApiFilesGet,
  importDemoSnapshotsApiFilesImportDemoSnapshotsPost,
  importLdacaDatasetApiFilesImportLdacaPost,
  importSampleDataApiFilesImportSampleDataPost,
  listLdacaFeaturedCollectionsApiFilesLdacaFeaturedGet,
  moveFileApiFilesMovePost,
  searchLdacaCollectionsApiFilesLdacaSearchPost,
  unifiedFilePreviewApiFilesPreviewPost,
  uploadFileApiFilesUploadPost,
} from '@/api/generated/sdk.gen';
import type {
  CreateFolderResponse,
  DemoSnapshotEntry as GeneratedDemoSnapshotEntry,
  DemoSnapshotImportResult as GeneratedDemoSnapshotImportResult,
  DemoSnapshotsCatalogueResponse as GeneratedDemoSnapshotsCatalogueResponse,
  FilePreviewRequest,
  FilePreviewResponse as GeneratedFilePreviewResponse,
  FileTreeNodeResponse,
  FilesImportTaskStartResponse,
  OniSearchRequest,
  OniSearchResponse,
  OniSearchResult,
  SampleDataCatalogueResponse as GeneratedSampleDataCatalogueResponse,
  SampleDataCollection as GeneratedSampleDataCollection,
} from '@/api/generated/types.gen';

const LDACA_API_TOKEN_HEADER = 'X-LDACA-API-Token';

function withLdacaApiToken(
  headers: Record<string, string> = {},
  token?: string | null,
): Record<string, string> {
  const trimmed = token?.trim();
  return trimmed ? { ...headers, [LDACA_API_TOKEN_HEADER]: trimmed } : headers;
}

export type FileTreeFile = Omit<FileTreeNodeResponse, 'children' | 'size' | 'type'> & {
  type: 'file';
  size: number;
};

export type FileTreeDirectory = Omit<FileTreeNodeResponse, 'children' | 'type'> & {
  type: 'directory';
  children: FileTreeNode[];
};

export type FileTreeNode = FileTreeFile | FileTreeDirectory;

export type MoveFileResponse = CreateFolderResponse;

export type UnifiedFilePreviewRequest = FilePreviewRequest;

export type FilePreviewResult = Omit<
  GeneratedFilePreviewResponse,
  'file_type' | 'selected_sheet' | 'sheet_names'
> & {
  file_type: string | null;
  selected_sheet: string | null;
  sheet_names: string[] | null;
};

export type LdacaImportStartResponse = Omit<FilesImportTaskStartResponse, 'state'> & {
  state: 'running';
};

export type LdacaSearchMethod = 'keyword' | 'identifier';

export type LdacaSearchRequest = Omit<OniSearchRequest, 'method' | 'query'> & {
  method: LdacaSearchMethod;
  query: string;
};

export type LdacaSearchResult = OniSearchResult & {
  importable: boolean;
  stats: Record<string, unknown>;
  types: string[];
};

export type LdacaSearchResponse = Omit<OniSearchResponse, 'data' | 'state'> & {
  data: LdacaSearchResult[];
  state: 'successful';
};

export type SampleDataCollectionStatus = 'bundled' | 'downloaded' | 'partial' | 'not_downloaded';

export type SampleDataCollectionView = Omit<GeneratedSampleDataCollection, 'status'> & {
  status: SampleDataCollectionStatus;
};

export type SampleDataCatalogue = Omit<GeneratedSampleDataCatalogueResponse, 'collections'> & {
  collections: SampleDataCollectionView[];
};

// ── Demo-snapshot catalogue ─────────────────────────────────────────────
//
// Parallel to the sample-data catalogue. Each entry is a single
// ``.ldaca-snapshot`` bundle hosted under ``demo_snapshots/`` in the
// sample-data repo. The frontend renders these as a second tab in the
// import dialog; importing writes the bundle into the user's snapshot
// folder so each tool's Load dialog discovers it automatically.

export type DemoSnapshotStatus = 'downloaded' | 'not_downloaded' | 'conflict';

export type DemoSnapshotEntryView = Omit<GeneratedDemoSnapshotEntry, 'status'> & {
  status: DemoSnapshotStatus;
};

export type DemoSnapshotsCatalogue = Omit<GeneratedDemoSnapshotsCatalogueResponse, 'snapshots'> & {
  snapshots: DemoSnapshotEntryView[];
};

export type DemoSnapshotImportStatus =
  | 'imported'
  | 'replaced'
  | 'skipped_existing'
  | 'skipped_conflict'
  | 'failed';

export type DemoSnapshotImportOutcome = Omit<GeneratedDemoSnapshotImportResult, 'status'> & {
  status: DemoSnapshotImportStatus;
};

export const filesApi = {
  list: async (headers: Record<string, string> = {}): Promise<FileTreeNode[]> => {
    const { data } = await getUserFilesApiFilesGet({ headers, throwOnError: true });
    return data as FileTreeNode[];
  },

  raw: async (path: string, headers: Record<string, string> = {}): Promise<string> => {
    const { data } = await getRawFileApiFilesRawGet({
      headers,
      parseAs: 'text',
      query: { path },
      throwOnError: true,
    });
    return data as string;
  },

  createFolder: async (parentPath: string, name: string, headers: Record<string, string> = {}) => {
    const { data } = await createFolderApiFilesFoldersPost({
      body: { parent_path: parentPath, name },
      headers,
      throwOnError: true,
    });
    return data;
  },

  moveFile: async (
    sourcePath: string,
    targetDirectoryPath: string,
    headers: Record<string, string> = {},
  ): Promise<MoveFileResponse> => {
    const { data } = await moveFileApiFilesMovePost({
      body: { source_path: sourcePath, target_directory_path: targetDirectoryPath },
      headers,
      throwOnError: true,
    });
    return data;
  },

  upload: async (file: File, headers: Record<string, string> = {}) => {
    const { data } = await uploadFileApiFilesUploadPost({
      body: { file },
      headers,
      throwOnError: true,
    });
    return data;
  },

  download: async (fileName: string, headers: Record<string, string> = {}): Promise<Blob> => {
    const { data } = await downloadFileApiFilesFilenameGet({
      headers,
      parseAs: 'blob',
      path: { filename: fileName },
      throwOnError: true,
    });
    return data as Blob;
  },

  preview: async (body: UnifiedFilePreviewRequest, headers: Record<string, string> = {}) => {
    const { data } = await unifiedFilePreviewApiFilesPreviewPost({ body, headers, throwOnError: true });
    return data as FilePreviewResult;
  },

  delete: async (fileName: string, headers: Record<string, string> = {}) => {
    const { data } = await deleteFileApiFilesFilenameDelete({
      headers,
      path: { filename: fileName },
      throwOnError: true,
    });
    return data;
  },

  getSampleDataCatalogue: async (headers: Record<string, string> = {}) => {
    const { data } = await getSampleDataCatalogueApiFilesSampleDataCatalogueGet({ headers, throwOnError: true });
    return data as SampleDataCatalogue;
  },

  getSampleDataReadme: async (path: string, headers: Record<string, string> = {}) => {
    const { data } = await getSampleDataReadmeApiFilesSampleDataReadmeGet({
      headers,
      parseAs: 'text',
      query: { path },
      throwOnError: true,
    });
    return data as string;
  },

  importSampleData: async (collectionIds: string[] = [], headers: Record<string, string> = {}) => {
    const { data } = await importSampleDataApiFilesImportSampleDataPost({
      body: { collection_ids: collectionIds },
      headers,
      throwOnError: true,
    });
    return data;
  },

  getDemoSnapshotsCatalogue: async (headers: Record<string, string> = {}) => {
    const { data } = await getDemoSnapshotsCatalogueApiFilesDemoSnapshotsCatalogueGet({
      headers,
      throwOnError: true,
    });
    return data as DemoSnapshotsCatalogue;
  },

  importDemoSnapshots: async (
    snapshotIds: string[] = [],
    replaceIds: string[] = [],
    headers: Record<string, string> = {},
  ) => {
    const { data } = await importDemoSnapshotsApiFilesImportDemoSnapshotsPost({
      body: { snapshot_ids: snapshotIds, replace_ids: replaceIds },
      headers,
      throwOnError: true,
    });
    return data;
  },

  getLdacaFeatured: async (headers: Record<string, string> = {}, ldacaApiToken?: string | null) => {
    const { data } = await listLdacaFeaturedCollectionsApiFilesLdacaFeaturedGet({
      headers: withLdacaApiToken(headers, ldacaApiToken),
      throwOnError: true,
    });
    return data as LdacaSearchResponse;
  },

  searchLdaca: async (
    request: LdacaSearchRequest,
    headers: Record<string, string> = {},
    ldacaApiToken?: string | null,
  ) => {
    const { data } = await searchLdacaCollectionsApiFilesLdacaSearchPost({
      body: request,
      headers: withLdacaApiToken(headers, ldacaApiToken),
      throwOnError: true,
    });
    return data as LdacaSearchResponse;
  },

  importLdaca: async (url: string, headers: Record<string, string> = {}, ldacaApiToken?: string | null) => {
    const { data } = await importLdacaDatasetApiFilesImportLdacaPost({
      body: { url },
      headers: withLdacaApiToken(headers, ldacaApiToken),
      throwOnError: true,
    });
    return data as LdacaImportStartResponse;
  },

  clearTasks: async (
    payload: { task_type?: string; task_id?: string } = {},
    headers: Record<string, string> = {},
  ) => {
    const { data } = await clearFilesTasksApiFilesTasksClearPost({
      headers,
      query: payload,
      throwOnError: true,
    });
    return data;
  },
};
