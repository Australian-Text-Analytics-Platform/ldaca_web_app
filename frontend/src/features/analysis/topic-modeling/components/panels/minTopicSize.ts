export function sanitizeMinTopicSizeInput(value: string): number {
  return Math.max(2, Number(value) || 0);
}
