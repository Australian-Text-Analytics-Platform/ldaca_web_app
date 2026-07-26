export interface NodeDataRequest {
  page: number;
  page_size: number;
  sort_by: string | null;
  descending: boolean;
}

export type AnalysisResultQueryKey = Readonly<Record<string, unknown>>;

/**
 * Builds the complete node-data query shape used by SQL and cache identity.
 * Used by: Data View plus node-page consumers such as annotation and language
 * detection, which must not let omitted defaults create cache aliases.
 * Flow: apply backend defaults, preserve explicit nullable sort/filter fields,
 * and return one serializable request value including `filter_op`.
 */
export const createNodeDataRequest = (
  request: Pick<NodeDataRequest, 'page' | 'page_size'> & Partial<NodeDataRequest>,
): NodeDataRequest => ({
  page: request.page,
  page_size: request.page_size,
  sort_by: request.sort_by ?? null,
  descending: request.descending ?? false,
});

/**
 * TanStack Query key factory.
 *
 * Keys form resource hierarchies. Collection lists have an explicit `list`
 * segment, while individual resource projections live under their opaque id.
 * This keeps ordinary list refreshes from invalidating every detail query.
 *
 * Only keys with at least one call site are listed here — add entries when
 * a new cached query needs targeted invalidation.
 */
export const queryKeys = {
  /** Workspace summaries shown by selectors and the Data Loader. */
  workspaceList: ['workspaces', 'list'] as const,

  /** Account-scoped preferences; the user id prevents cross-account cache reuse. */
  userPreferences: (userId: string | null) => ['user-preferences', userId] as const,

  /** Every cached server resource owned by one Analysis session. */
  analysisSession: (workspaceId: string, analysisId: string) =>
    ['workspaces', workspaceId, 'analyses', analysisId] as const,

  /** Stable paginated list of Analyses owned by one Workspace. */
  workspaceAnalyses: (workspaceId: string) =>
    ['workspaces', workspaceId, 'analyses', 'list'] as const,

  /** Canonical lifecycle and immutable request for one Analysis. */
  analysis: (workspaceId: string, analysisId: string) =>
    ['workspaces', workspaceId, 'analyses', analysisId, 'resource'] as const,

  /** Every output projection belonging to one successful Analysis. */
  analysisResults: (workspaceId: string, analysisId: string) =>
    ['workspaces', workspaceId, 'analyses', analysisId, 'results'] as const,

  /** Output-only Result keyed by the complete projection query. */
  analysisResult: (workspaceId: string, analysisId: string, query?: AnalysisResultQueryKey) =>
    [...queryKeys.analysisResults(workspaceId, analysisId), query ?? { kind: 'default' }] as const,

  /** One immutable paged table projection owned by a successful Analysis Result. */
  analysisTablePage: (
    workspaceId: string,
    analysisId: string,
    tableId: string,
    request: NodeDataRequest,
  ) => [...queryKeys.analysisResults(workspaceId, analysisId), 'tables', tableId, request] as const,

  /** Paginated user-owned file imports shown in the Task Inbox. */
  userFileImports: ['user-file-imports', 'list'] as const,

  /** One authoritative user-owned file import resource. */
  userFileImport: (importId: string) => ['user-file-imports', importId] as const,

  /** All durable Tabs for one Workspace, shared by every analysis view. */
  workspaceTabs: (workspaceId: string) => ['workspaces', workspaceId, 'tabs'] as const,

  /** Workspace SQL pages include every declared Data Block dependency. */
  workspaceSql: (
    workspaceId: string,
    nodeIds: string[],
    sql: string,
    page: number,
    pageSize: number,
  ) => ['workspaces', workspaceId, 'sql', { nodeIds: [...nodeIds], sql, page, pageSize }] as const,

  /** Infinite SQL projection whose page identity is owned by TanStack Query's page params. */
  workspaceSqlInfinite: (workspaceId: string, nodeIds: string[], sql: string, pageSize: number) =>
    ['workspaces', workspaceId, 'sql', { nodeIds: [...nodeIds], sql, pageSize }] as const,

  /** Complete multi-page SQL projection drained into one immutable resource. */
  workspaceSqlDrain: (
    workspaceId: string,
    nodeIds: string[],
    sql: string,
    pageSize: number,
    projection: Readonly<Record<string, unknown>>,
  ) =>
    [
      'workspaces',
      workspaceId,
      'sql',
      { mode: 'drain', nodeIds: [...nodeIds], sql, pageSize, projection },
    ] as const,

  /** Full-table annotation comparison, maintained independently from ordinary SQL pages. */
  annotationColumnComparison: (
    workspaceId: string,
    nodeIds: string[],
    sql: string,
    referenceColumn: string,
    comparisonColumn: string,
  ) =>
    [
      'workspaces',
      workspaceId,
      'annotation-column-comparisons',
      { nodeIds: [...nodeIds], sql, referenceColumn, comparisonColumn },
    ] as const,

  /** Authoritative Arrow schema for one data block. */
  nodeSchema: (workspaceId: string, nodeId: string) =>
    ['workspaces', workspaceId, 'nodes', nodeId, 'schema'] as const,

  /** Every node-derived resource belonging to one Workspace. */
  workspaceNodes: (workspaceId: string) => ['workspaces', workspaceId, 'nodes'] as const,

  /** Every column-derived query for one Data Block. */
  nodeColumns: (workspaceId: string, nodeId: string) =>
    ['workspaces', workspaceId, 'nodes', nodeId, 'columns'] as const,

  /** Client-detected language for one column and one sampled table revision. */
  detectedColumnLanguage: (
    workspaceId: string,
    nodeId: string,
    columnName: string,
    sourceRevision: string,
  ) =>
    [
      ...queryKeys.nodeColumns(workspaceId, nodeId),
      columnName,
      'detected-language',
      { sourceRevision },
    ] as const,

  /** Workspace graph topology consumed by the graph/sidebar workspace view. */
  workspaceGraph: (workspaceId: string) => ['workspaces', workspaceId, 'graph'] as const,

  /** Stable disabled key for the graph observer before a Workspace is open. */
  inactiveWorkspaceGraph: ['inactive', 'workspace-graph'] as const,

  /** Stable disabled key for the Analysis list before a Workspace is open. */
  inactiveWorkspaceAnalyses: ['inactive', 'workspace-analyses'] as const,

  /** Stable disabled key for an Analysis resource before session identity exists. */
  inactiveAnalysis: ['inactive', 'analysis'] as const,

  /** Disabled Result key that retains projection identity for useQueries observers. */
  inactiveAnalysisResult: (query?: AnalysisResultQueryKey) =>
    ['inactive', 'analysis-result', query ?? { kind: 'default' }] as const,

  /** Every preprocessing preview belonging to one Workspace. */
  preprocessingPreviews: (workspaceId: string) =>
    ['workspaces', workspaceId, 'preprocessing-previews'] as const,

  /** One shared idle key used while no preprocessing request is ready. */
  preprocessingPreviewDisabled: ['preprocessing-previews', 'disabled'] as const,

  /** One operation preview, including all source dependencies and request state. */
  preprocessingPreview: (
    workspaceId: string,
    operation: string,
    nodeIds: readonly string[],
    request: unknown,
    page: number,
    pageSize: number,
  ) =>
    [
      ...queryKeys.preprocessingPreviews(workspaceId),
      { operation, nodeIds: [...nodeIds], request, page, pageSize },
    ] as const,

  /** User-visible file tree. */
  fileList: ['files', 'list'] as const,

  /** Every projection of one path-addressed user file. */
  file: (filename: string) => ['files', 'items', filename] as const,

  /** Workbook sheet inventory for one file. */
  fileWorksheets: (filename: string) => [...queryKeys.file(filename), 'worksheets'] as const,

  /** Paginated preview of an unsaved file (sheets/CSV/etc). */
  filePreview: (filename: string, page: number, pageSize: number, selectedSheet: string | null) =>
    [...queryKeys.file(filename), 'preview', { page, pageSize, sheet: selectedSheet }] as const,

  /** Raw text projection of one file, such as a sample README. */
  fileRaw: (filename: string) => [...queryKeys.file(filename), 'raw'] as const,

  /** Safe provider-credential summary; never contains raw secrets. */
  providerCredentials: ['provider-credentials'] as const,

  /** Backend tokenizer model inventory. */
  tokenizerModels: ['catalogues', 'tokenizer-models'] as const,

  /** Remote sample-data collection inventory. */
  sampleCollections: ['catalogues', 'sample-collections'] as const,

  /** Every Annotation provider model inventory. */
  annotationModels: ['catalogues', 'annotation-models'] as const,

  /** Every model inventory for one safe provider configuration id. */
  annotationModelsForConfiguration: (configurationId: string) =>
    [...queryKeys.annotationModels, configurationId] as const,

  /** Provider model inventory, revised when its browser-owned credential changes. */
  annotationModelList: (
    configurationId: string,
    credentialRevision: number,
    provider: string,
    baseUrl: string | null,
  ) =>
    [
      ...queryKeys.annotationModelsForConfiguration(configurationId),
      { credentialRevision, provider, baseUrl },
    ] as const,

  /** Per-column unique-value counts (used by sequential-analysis). */
  columnUniqueValues: (workspaceId: string, nodeId: string, columnName: string) =>
    [...queryKeys.nodeColumns(workspaceId, nodeId), columnName, 'unique-values'] as const,
};
