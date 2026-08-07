/**
 * UI-only projections of the generated backend resources.
 *
 * This module deliberately contains no HTTP helpers.  The generated SDK is
 * the only API contract; these types only describe the additional view state
 * that is assembled by React components after an API response is received.
 */
import type {
  AvailableWorkspaceListItem,
  ConcordancePage,
  ConcordanceResult,
  DataPortalRecord,
  DataPortalSearchRequest,
  ExpressionNodeCreateRequest,
  FileResource,
  QuotationResult,
  ResultColumnMetadata,
  SampleCollection,
  SequentialResult,
  TokenFrequencyAnalysisRequest,
  TokenFrequencyResult,
  TopicItem,
  TopicModelingAnalysisRequest,
  TopicModelingResult,
  TokenizerModelResource,
  QuotationEngineSelection,
  WorkspaceNodeInfo,
  ListWorkspacesResponse,
  UnavailableWorkspaceListItem,
} from './generated/types.gen';
import type { ColumnKind } from '@/lib/arrow/arrowTable';

export type ConcordanceNodeResult = Omit<ConcordancePage, 'metadata'> & {
  metadata: ResultColumnMetadata & {
    metadata_columns: string[];
    concordance_columns: string[];
    quotation_columns: string[];
  };
};

export type ConcordanceAnalysisResponse = ConcordanceResult & {
  data: Record<string, ConcordanceNodeResult>;
  combinable: boolean;
  metadata: ResultColumnMetadata;
};

export interface TokenFrequencyStatisticsEntry {
  token: string;
  freq_reference?: number | string | null;
  percent_reference?: number | string | null;
  freq_study?: number | string | null;
  percent_study?: number | string | null;
  log_likelihood_llv?: number | string | null;
  percent_diff?: number | string | null;
  bayes_factor_bic?: number | string | null;
  effect_size_ell?: number | string | null;
  relative_risk?: number | string | null;
  log_ratio?: number | string | null;
  odds_ratio?: number | string | null;
  significance?: string;
}

export type TokenFrequencyResponse = Omit<TokenFrequencyResult, 'tables'> & {
  tables?: TokenFrequencyResult['tables'];
  data: Record<string, { data: Record<string, unknown>[]; metadata: Record<string, unknown> }>;
  statistics?: TokenFrequencyStatisticsEntry[];
};

export type TopicModelingResponse = Omit<TopicModelingResult, 'topics'> & {
  topics: TopicModelingResult['topics'];
  data: {
    topics: TopicModelingResult['topics'];
    corpus_sizes: number[];
    meta: TopicModelingResult['meta'];
    per_corpus_topic_counts?: Record<string, number>[] | null;
  };
};

export type QuotationAnalysisResponse = QuotationResult;

export type SequentialAnalysisResponse = Omit<SequentialResult, 'table'> & {
  table?: SequentialResult['table'];
  data: Record<string, unknown>[];
};

export type WorkspaceGraphNode = WorkspaceNodeInfo;
export interface WorkspaceGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}
export interface WorkspaceGraphResponse {
  nodes: WorkspaceGraphNode[];
  edges: WorkspaceGraphEdge[];
}
export type WorkspaceCatalogueItem = ListWorkspacesResponse[number];
export type WorkspaceSummary = AvailableWorkspaceListItem & { availability: 'available' };
export type UnavailableWorkspaceSummary = UnavailableWorkspaceListItem & {
  availability: 'unavailable';
};

export interface FileTreeNodeResponse {
  name: string;
  path: string;
  type: FileResource['type'];
  size?: number | null;
  size_bytes?: number | null;
  modified_at?: number;
  file_type?: string | null;
  loadable?: boolean;
  children?: FileTreeNodeResponse[];
}

export interface NodeDataResponse {
  page: number;
  page_size: number;
  rows: Record<string, unknown>[];
  columns: string[];
  columnKinds: Record<string, ColumnKind>;
  has_next: boolean;
}
export interface SourceRowPagination {
  page: number;
  page_size: number;
  total_source_rows: number;
  total_source_pages: number;
  result_count: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface OniSearchRequest extends DataPortalSearchRequest {
  page?: number;
  page_size?: number;
}
export type OniSearchResult = DataPortalRecord;
export type SampleDataCollection = SampleCollection;

export interface AnnotationClassDescriptionRow {
  class: string;
  description: string;
}
export type PolarsExpressionRequest = Pick<
  ExpressionNodeCreateRequest,
  'context' | 'expressions' | 'group_by' | 'name'
>;
export type PolarsExpressionApplyResponse = WorkspaceNodeInfo;
export type TokenFrequencyRequest = TokenFrequencyAnalysisRequest;
export type TopicModelingRequest = TopicModelingAnalysisRequest;
export type QuotationEngineConfig = QuotationEngineSelection;
export type QuotationMetadata = ResultColumnMetadata;
export type TopicModelingTopic = TopicItem;

export interface TokenizerModelInfo {
  model: TokenizerModelResource['id'];
  label: TokenizerModelResource['label'];
  languages: string[];
}

export function toFileTree(resources: FileResource[]): FileTreeNodeResponse[] {
  const roots: FileTreeNodeResponse[] = [];
  const directories = new Map<string, FileTreeNodeResponse>();

  const ensureDirectory = (path: string): FileTreeNodeResponse => {
    const existing = directories.get(path);
    if (existing) return existing;
    const name = path.split('/').at(-1) ?? path;
    const directory: FileTreeNodeResponse = {
      name,
      path,
      type: 'directory',
      children: [],
    };
    directories.set(path, directory);
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (parentPath) ensureDirectory(parentPath).children?.push(directory);
    else roots.push(directory);
    return directory;
  };

  for (const resource of resources) {
    if (resource.type === 'directory') {
      ensureDirectory(resource.path);
      continue;
    }
    const parentPath = resource.path.includes('/')
      ? resource.path.slice(0, resource.path.lastIndexOf('/'))
      : '';
    const file: FileTreeNodeResponse = {
      name: resource.name,
      path: resource.path,
      type: 'file',
      size: resource.size_bytes ?? 0,
      size_bytes: resource.size_bytes,
      modified_at: resource.modified_at,
      file_type: resource.file_type,
      loadable: resource.loadable,
    };
    if (parentPath) ensureDirectory(parentPath).children?.push(file);
    else roots.push(file);
  }
  return roots;
}
