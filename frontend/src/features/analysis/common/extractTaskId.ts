/**
 * Extracts `metadata.task_id` from an analysis submit response and eagerly
 * stores it via `setLocalTaskId` so that `resolveTaskId()` can return it
 * without falling back to slower server queries.
 *
 * Every analysis task-flow hook should call this immediately after a
 * successful submit/search API call.
 */
export function extractAndSetTaskId(
  response: unknown,
  setLocalTaskId: (id: string | null) => void,
): string | null {
  const metadata = (response as Record<string, unknown> | null | undefined)
    ?.metadata as Record<string, unknown> | null | undefined;
  const taskId = metadata?.task_id;
  if (typeof taskId === 'string' && taskId.trim().length > 0) {
    setLocalTaskId(taskId);
    return taskId;
  }
  return null;
}
