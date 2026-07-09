/**
 * Canonical ids shared by analysis tab sidecars, task hydration, and task-status
 * subscriptions.
 * Used by: the view registry, analysis feature configs, and task-stream
 * helpers so one logical analysis id is not repeated as unrelated literals.
 */
export const ANALYSIS_TAB_GROUPS = {
  annotation: 'annotation',
  concordance: 'concordance_analysis',
  quotation: 'quotation_analysis',
  sequential: 'sequential_analysis',
  tokenFrequencies: 'token_frequencies',
  topicModeling: 'topic_modeling',
} as const;

type AnalysisTabGroup = (typeof ANALYSIS_TAB_GROUPS)[keyof typeof ANALYSIS_TAB_GROUPS];
export type LastRunAnalysisType = Exclude<AnalysisTabGroup, typeof ANALYSIS_TAB_GROUPS.annotation>;

export const ANALYSIS_TASK_TYPES = {
  concordance: 'concordance',
  quotation: 'quotation',
  sequential: 'sequential_analysis',
  tokenFrequencies: 'token_frequencies',
  topicModeling: 'topic_modeling',
} as const;

export type CanonicalAnalysisTaskType =
  (typeof ANALYSIS_TASK_TYPES)[keyof typeof ANALYSIS_TASK_TYPES];
