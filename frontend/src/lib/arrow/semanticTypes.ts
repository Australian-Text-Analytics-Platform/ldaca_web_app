import type { ArrowField } from './arrowTable';
import { arrowExtensionName } from './arrowTable';

/** Exact semantic identity published by the backend in Arrow extension metadata. */
export const TOPIC_DISTRIBUTION_EXTENSION = 'org.ldaca.wordflow.topic_distribution.v1';

/**
 * Detects the Topic Distribution extension without assigning it a second
 * frontend type name. Used by Data View and Filter because those features
 * provide behavior beyond generic Arrow value rendering.
 */
export const isTopicDistributionField = (field: ArrowField | undefined): boolean =>
  field !== undefined && arrowExtensionName(field) === TOPIC_DISTRIBUTION_EXTENSION;
