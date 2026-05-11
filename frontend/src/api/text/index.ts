/**
 * `textApi` is the unified surface for every analysis-feature endpoint.
 * Implementation is split per-feature under `api/text/*.ts` so each feature
 * owns its types + methods in one file, but consumers continue to import
 * `textApi` and the shared types from `@/api/text` exactly as before.
 */
import { httpRequest } from '../http';

import { aiAnnotationApi } from './aiAnnotation';
import { concordanceApi } from './concordance';
import { quotationApi } from './quotation';
import { sequentialAnalysisApi } from './sequential';
import { tokenFrequencyApi } from './tokenFrequency';
import { topicModelingApi } from './topicModeling';

// Public type surface — re-export every type-level export from the feature
// files so existing `import { Foo } from '@/api/text'` call sites keep
// resolving without churn.
export type { SourceRowPagination } from './shared';

export type {
  ConcordanceAnalysisRequest,
  ConcordanceAnalysisResponse,
  ConcordanceDetachNodeOption,
  ConcordanceDetachOptionsResponse,
  ConcordanceDetachRequest,
  ConcordanceDispersionBinRow,
  ConcordanceDispersionBinsResponse,
  ConcordanceGroupedRow,
  ConcordanceHitRow,
  ConcordanceMaterializeRequest,
  ConcordanceMetadata,
  ConcordancePagination,
  ConcordanceRequest,
  ConcordanceResultEntry,
  ConcordanceResultQuery,
} from './concordance';

export type {
  QuotationAnalysisResponse,
  QuotationDetachNodeOption,
  QuotationDetachOptionsResponse,
  QuotationDetachRequest,
  QuotationEngineConfig,
  QuotationEngineType,
  QuotationGroupedRow,
  QuotationHitRow,
  QuotationMaterializeRequest,
  QuotationMetadata,
  QuotationPagination,
  QuotationRequest,
  QuotationResultQuery,
} from './quotation';

export type {
  SequentialAnalysisDetachRequest,
  SequentialAnalysisDetachResponse,
  SequentialAnalysisRequest,
  SequentialCustomIntervalUnit,
  SequentialFrequency,
} from './sequential';

export type {
  TokenFrequencyNodeResult,
  TokenFrequencyRequest,
  TokenFrequencyResponse,
} from './tokenFrequency';

export type {
  TopicModelingData,
  TopicModelingDetachNodeOption,
  TopicModelingDetachOptionsResponse,
  TopicModelingDetachRequest,
  TopicModelingDetachResponse,
  TopicModelingRequest,
  TopicModelingResponse,
  TopicModelingResultUpdate,
  TopicModelingTopic,
} from './topicModeling';

export type {
  AiAnnotationCategoriesResponse,
  AiAnnotationClassDef,
  AiAnnotationDetachRequest,
  AiAnnotationEdit,
  AiAnnotationExample,
  AiAnnotationModelsRequest,
  AiAnnotationModelsResponse,
  AiAnnotationNodeResult,
  AiAnnotationProvidersResponse,
  AiAnnotationRequest,
  AiAnnotationResponse,
  AiAnnotationResultQuery,
  AiAnnotationSaveRequest,
} from './aiAnnotation';

const ANALYSIS_URL_SLUG: Record<string, string> = {
  concordance: 'concordance',
  concordance_analysis: 'concordance',
  ai_annotation: 'ai-annotation',
  quotation: 'quotation',
  quotation_analysis: 'quotation',
  token_frequencies: 'token-frequencies',
  topic_modeling: 'topic-modeling',
  sequential_analysis: 'sequential-analysis',
};

/**
 * Fetch the current/most-recent task descriptor for a given analysis kind.
 * Lives at the top level because every feature defers to the same endpoint
 * shape, just with a different URL slug.
 */
const getAnalysisCurrent = (analysis: string, headers: Record<string, string> = {}) => {
  const slug = ANALYSIS_URL_SLUG[analysis] ?? analysis.replace(/_/g, '-');
  return httpRequest<Record<string, unknown>>(
    `/workspaces/${slug}/tasks/current`,
    { method: 'GET', headers },
  );
};

export const textApi = {
  ...concordanceApi,
  ...quotationApi,
  ...sequentialAnalysisApi,
  ...tokenFrequencyApi,
  ...topicModelingApi,
  ...aiAnnotationApi,
  getAnalysisCurrent,
};
