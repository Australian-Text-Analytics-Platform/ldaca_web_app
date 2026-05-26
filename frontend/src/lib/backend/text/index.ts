/**
 * `textApi` is the unified surface for every analysis-feature endpoint.
 * Implementation is split per-feature under `api/text/*.ts` so each feature
 * owns its types + methods in one file, but consumers continue to import
 * `textApi` and the shared types from `@/lib/backend/text` exactly as before.
 */
import {
  aiAnnotationCurrentTasksApiWorkspacesAiAnnotationTasksCurrentGet,
  concordanceCurrentTasksApiWorkspacesConcordanceTasksCurrentGet,
  quotationCurrentTasksApiWorkspacesQuotationTasksCurrentGet,
  sequentialAnalysisCurrentTasksApiWorkspacesSequentialAnalysisTasksCurrentGet,
  tokenFrequenciesCurrentTasksApiWorkspacesTokenFrequenciesTasksCurrentGet,
  topicModelingCurrentTasksApiWorkspacesTopicModelingTasksCurrentGet,
} from '@/api/generated/sdk.gen';

import { aiAnnotationApi } from './aiAnnotation';
import { concordanceApi } from './concordance';
import { quotationApi } from './quotation';
import { sequentialAnalysisApi } from './sequential';
import { tokenFrequencyApi } from './tokenFrequency';
import { topicModelingApi } from './topicModeling';

// Public type surface — re-export every type-level export from the feature
// files so existing `import { Foo } from '@/lib/backend/text'` call sites keep
// resolving without churn.
export type { LanguageCode, LanguageHint, SourceRowPagination } from './shared';
export { buildLanguageHint } from './shared';

export type {
  ConcordanceAnalysisRequest,
  ConcordanceAnalysisResponse,
  ConcordanceDetachNodeOption,
  ConcordanceDetachOptionsResponse,
  ConcordanceDetachRequest,
  ConcordanceDispersionBinRow,
  ConcordanceDispersionDetachRequest,
  ConcordanceDispersionBinsResponse,
  ConcordanceGroupedRow,
  ConcordanceHitRow,
  ConcordanceMaterializeRequest,
  ConcordanceMetadata,
  ConcordancePagination,
  ConcordanceRequest,
  ConcordanceResultEntry,
  ConcordanceResultQuery,
  ConcordanceSearchMode,
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
export { SNAPSHOT_FINEST_FREQUENCIES } from './sequential';

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

/**
 * Fetch the current/most-recent task descriptor for a given analysis kind.
 * Lives at the top level because every feature defers to the same endpoint
 * shape, just with a different URL slug.
 */
const getAnalysisCurrent = async (analysis: string, headers: Record<string, string> = {}) => {
  switch (analysis) {
    case 'concordance':
    case 'concordance_analysis': {
      const { data } = await concordanceCurrentTasksApiWorkspacesConcordanceTasksCurrentGet({ headers, throwOnError: true });
      return data as Record<string, unknown>;
    }
    case 'quotation':
    case 'quotation_analysis': {
      const { data } = await quotationCurrentTasksApiWorkspacesQuotationTasksCurrentGet({ headers, throwOnError: true });
      return data as Record<string, unknown>;
    }
    case 'ai_annotation': {
      const { data } = await aiAnnotationCurrentTasksApiWorkspacesAiAnnotationTasksCurrentGet({ headers, throwOnError: true });
      return data as Record<string, unknown>;
    }
    case 'token_frequencies': {
      const { data } = await tokenFrequenciesCurrentTasksApiWorkspacesTokenFrequenciesTasksCurrentGet({ headers, throwOnError: true });
      return data as Record<string, unknown>;
    }
    case 'topic_modeling': {
      const { data } = await topicModelingCurrentTasksApiWorkspacesTopicModelingTasksCurrentGet({ headers, throwOnError: true });
      return data as Record<string, unknown>;
    }
    case 'sequential_analysis': {
      const { data } = await sequentialAnalysisCurrentTasksApiWorkspacesSequentialAnalysisTasksCurrentGet({ headers, throwOnError: true });
      return data as Record<string, unknown>;
    }
    default:
      throw new Error(`Unsupported analysis type: ${analysis}`);
  }
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
