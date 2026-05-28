/** Used by: TopicModelingParameterPanel and its tests to coerce draft min-topic-size input because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
export function sanitizeMinTopicSizeInput(value: string): number {
  return Math.max(2, Number(value) || 0);
}
