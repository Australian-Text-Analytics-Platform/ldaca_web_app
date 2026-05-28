/**
 * Extracts `metadata.task_id` from an analysis submit response and eagerly
 * stores it via `setLocalTaskId` so that `resolveTaskId()` can return it
 * without falling back to slower server queries.
 *
 * Called by: analysis task-flow hooks immediately after successful submit/search API calls because the caller needs this analysis-specific step before continuing its request, result, display, or cleanup workflow.
 */
export function extractAndSetTaskId(
  response: unknown,
  setLocalTaskId: (id: string | null) => void,
): string | null {
  const responseRecord = response as Record<string, unknown> | null | undefined;
  const metadata = responseRecord?.metadata as Record<string, unknown> | null | undefined;
  const taskId =
    metadata?.task_id ??
    responseRecord?.task_id;
  if (typeof taskId === 'string' && taskId.trim().length > 0) {
    setLocalTaskId(taskId);
    return taskId;
  }
  return null;
}
