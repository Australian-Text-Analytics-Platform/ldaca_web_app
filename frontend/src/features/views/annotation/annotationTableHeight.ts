/** Shared sizing rules for the resizable Annotation result tables. */
export const ANNOTATION_TABLE_DEFAULT_HEIGHT = 384;
export const ANNOTATION_TABLE_MAX_VIEWPORT_RATIO = 0.75;

/** Clamps a requested table height to the shared floor and the 75% viewport ceiling. */
export function clampAnnotationTableHeight(height: number): number {
  const ceiling =
    typeof window === 'undefined'
      ? Number.POSITIVE_INFINITY
      : Math.floor(window.innerHeight * ANNOTATION_TABLE_MAX_VIEWPORT_RATIO);
  return Math.round(
    Math.min(
      Math.max(height, ANNOTATION_TABLE_DEFAULT_HEIGHT),
      Math.max(ceiling, ANNOTATION_TABLE_DEFAULT_HEIGHT),
    ),
  );
}
