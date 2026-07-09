/** Used by: TopicModelingParameterPanel and its tests to coerce draft min-topic-size input. */
export function sanitizeMinTopicSizeInput(value: string): number {
  return Math.max(2, Number(value) || 0);
}
