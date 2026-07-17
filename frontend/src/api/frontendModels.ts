/**
 * UI-only projections of the generated backend resources.
 *
 * This module deliberately contains no HTTP helpers.  The generated SDK is
 * the only API contract; these types only describe the additional view state
 * that is assembled by React components after an API response is received.
 */
import type {
  Analysis,
  ConcordancePage,
  ConcordanceResult,
  DataPortalRecord,
  DataPortalSearchRequest,
  FileResource,
  QuotationAnalysisRequest,
  QuotationResult,
  ResultColumnMetadata,
  SampleCollection,
  SequentialResult,
  Tab,
  TokenFrequencyAnalysisRequest,
  TokenFrequencyResult,
  TopicItem,
  TopicModelingAnalysisRequest,
  TopicModelingResult,
  TokenizerModelResource,
  QuotationEngineSelection,
  WorkspaceNodeInfo,
  WorkspaceResource,
} from './generated/types.gen';
import type { ColumnKind } from '@/lib/arrow/arrowTable';

export interface AnalysisResultUiState {
  state: 'queued' | 'running' | 'successful' | 'failed' | 'cancelled';
  message?: string;
}

export interface AnalysisTaskMetadata {
  task_id?: string | null;
  metadata_columns?: string[];
  concordance_columns?: string[];
  quotation_columns?: string[];
}

export type ConcordanceNodeResult = Omit<ConcordancePage, 'metadata'> & {
  metadata: ResultColumnMetadata & {
    metadata_columns: string[];
    concordance_columns: string[];
    quotation_columns: string[];
  };
};

export type ConcordanceAnalysisResponse = Omit<ConcordanceResult, 'data'> &
  AnalysisResultUiState & {
    data: Record<string, ConcordanceNodeResult>;
    metadata?: AnalysisTaskMetadata;
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

export type TokenFrequencyResponse = Omit<TokenFrequencyResult, 'tables'> &
  AnalysisResultUiState & {
    metadata: TokenFrequencyResult['metadata'] & AnalysisTaskMetadata;
    tables?: TokenFrequencyResult['tables'];
    data: Record<string, { data: Record<string, unknown>[]; metadata: Record<string, unknown> }>;
    statistics?: TokenFrequencyStatisticsEntry[];
  };

export type TopicModelingResponse = Omit<TopicModelingResult, 'topics'> &
  AnalysisResultUiState & {
    metadata?: AnalysisTaskMetadata;
    data: {
      topics: TopicModelingResult['topics'];
      corpus_sizes: number[];
      per_corpus_topic_counts?: Record<string, number>[] | null;
    };
  };

export type QuotationAnalysisResponse = QuotationResult &
  AnalysisResultUiState & {
    metadata: QuotationResult['metadata'] & AnalysisTaskMetadata;
  };

export type SequentialAnalysisResponse = Omit<SequentialResult, 'table'> &
  AnalysisResultUiState & {
    table?: SequentialResult['table'];
    data: Record<string, unknown>[];
    metadata?: AnalysisTaskMetadata;
    chart_type?: string;
    analysis_params?: Record<string, unknown>;
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
export type WorkspaceSummary = WorkspaceResource;

export interface FileTreeNodeResponse {
  name: string;
  path: string;
  type: FileResource['type'];
  size?: number | null;
  size_bytes?: number | null;
  modified_at?: number;
  file_type?: string | null;
  preview_available?: boolean;
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

export interface AnalysisTabInput {
  node_id: string;
  column?: string | null;
}

/** Presentation-only tab state retained for existing tab-panel components. */
export interface AnalysisTab {
  tab_id: string;
  task_id: string | null;
  title: string;
  input_sets: Record<string, AnalysisTabInput[]>;
  settings: Record<string, string>;
}
export interface WorkspaceTabsState {
  groups: Record<string, { tabs: AnalysisTab[]; active_tab_id: string | null }>;
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
export interface DetachNodeOption {
  node_id: string;
  node_name: string;
  text_column: string;
  available_columns: string[];
  disabled_columns?: string[];
}
export interface ColumnInfo {
  name: string;
  dtype: string;
}
export interface ColumnOperationsResponse {
  operations: Record<string, { method: string; label: string }[]>;
}

export type PolarsExpressionContext =
  | 'filter'
  | 'group_by_agg'
  | 'select'
  | 'sort'
  | 'with_columns';
export interface PolarsExpressionRequest {
  context: PolarsExpressionContext;
  expressions: Record<string, unknown>[];
  group_by?: Record<string, unknown>[];
  name?: string | null;
}
export type PolarsExpressionApplyResponse = WorkspaceNodeInfo;
export type ReplaceRequest = Record<string, unknown>;
export type ReplaceApplyResponse = WorkspaceNodeInfo;
export type SliceRequest = Record<string, unknown>;
export type FilterCondition = Record<string, unknown>;
export type FilterRequest = Record<string, unknown>;
export type TokenFrequencyRequest = TokenFrequencyAnalysisRequest;
export type TopicModelingRequest = TopicModelingAnalysisRequest;
export type QuotationRequest = QuotationAnalysisRequest;
export type QuotationEngineConfig = QuotationEngineSelection;
export type QuotationMetadata = ResultColumnMetadata & AnalysisTaskMetadata;
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
      preview_available: resource.preview_available,
    };
    if (parentPath) ensureDirectory(parentPath).children?.push(file);
    else roots.push(file);
  }
  return roots;
}

function analysisUiState(analysis: Analysis): AnalysisResultUiState {
  return {
    state: analysis.state === 'succeeded' ? 'successful' : analysis.state,
    message: analysis.error?.message,
  };
}

const analysisTaskMetadata = (analysis: Analysis): AnalysisTaskMetadata => ({
  task_id: analysis.id,
});

/** Combine the canonical Analysis resource and typed result into a view-only model. */
export function normalizeAnalysisResult(result: unknown, analysis: Analysis): unknown {
  const ui = analysisUiState(analysis);
  if (!result || typeof result !== 'object') return { ...ui };
  const value = result as Record<string, unknown>;
  switch (value.kind) {
    case 'concordance': {
      const data: Record<string, ConcordanceNodeResult> = {};
      const rawData = value.data;
      if (rawData && typeof rawData === 'object') {
        Object.entries(rawData).forEach(([key, entry]) => {
          if (!entry || typeof entry !== 'object') return;
          const page = entry as ConcordancePage;
          data[key] = {
            ...page,
            metadata: {
              ...page.metadata,
              metadata_columns: page.metadata.metadata_columns ?? [],
              concordance_columns: page.metadata.concordance_columns ?? [],
              quotation_columns: page.metadata.quotation_columns ?? [],
            },
          };
        });
      }
      const firstPage = Object.values(data)[0];
      return {
        ...value,
        ...ui,
        data,
        metadata: {
          ...analysisTaskMetadata(analysis),
          metadata_columns: firstPage?.metadata.metadata_columns ?? [],
          concordance_columns: firstPage?.metadata.concordance_columns ?? [],
          quotation_columns: firstPage?.metadata.quotation_columns ?? [],
        },
      };
    }
    case 'token_frequency':
      return {
        ...value,
        ...ui,
        metadata: { ...(value.metadata as object), ...analysisTaskMetadata(analysis) },
        statistics: Array.isArray(value.statistics) ? value.statistics : [],
      };
    case 'topic_modeling':
      return {
        ...value,
        ...ui,
        metadata: analysisTaskMetadata(analysis),
        data: {
          topics: value.topics as TopicModelingResult['topics'],
          corpus_sizes: value.corpus_sizes as number[],
          per_corpus_topic_counts:
            (value.per_corpus_topic_counts as Record<string, number>[] | null) ?? null,
        },
      };
    case 'quotation':
      return {
        ...value,
        ...ui,
        metadata: { ...(value.metadata as object), ...analysisTaskMetadata(analysis) },
      };
    case 'sequential':
      return { ...value, ...ui, metadata: analysisTaskMetadata(analysis) };
    default:
      return { ...value, ...ui };
  }
}

export type GeneratedTab = Tab;
