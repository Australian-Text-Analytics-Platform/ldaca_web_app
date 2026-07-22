/**
 * Canonical analysis kinds shared by server-owned tabs and feature routing.
 * Used by: the view registry, analysis feature configs, and task-stream
 * helpers so one logical analysis id is not repeated as unrelated literals.
 */
export const ANALYSIS_TAB_GROUPS = {
  annotation: 'annotation',
  concordance: 'concordance',
  quotation: 'quotation',
  sequential: 'sequential',
  tokenFrequencies: 'token_frequency',
  topicModeling: 'topic_modeling',
} as const;

export const ANALYSIS_TASK_TYPES = {
  annotation: 'annotation',
  concordance: 'concordance',
  quotation: 'quotation',
  sequential: 'sequential',
  tokenFrequencies: 'token_frequency',
  topicModeling: 'topic_modeling',
} as const;

export type CanonicalAnalysisTaskType =
  (typeof ANALYSIS_TASK_TYPES)[keyof typeof ANALYSIS_TASK_TYPES];
