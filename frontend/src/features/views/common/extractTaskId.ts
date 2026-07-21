/**
 * Extracts `metadata.task_id` from an analysis submit response and eagerly
 * stores it via `setLocalTaskId` so that `resolveTaskId()` can return it
 * without falling back to slower server queries.
 */
export function extractAndSetTaskId(
  response: unknown,
  setLocalTaskId: (id: string | null) => void,
): string | null {
  const responseRecord = response as Record<string, unknown> | null | undefined;
  const metadata = responseRecord?.metadata as Record<string, unknown> | null | undefined;
  const taskId = metadata?.task_id ?? responseRecord?.task_id ?? responseRecord?.id;
  if (typeof taskId === 'string' && taskId.trim().length > 0) {
    setLocalTaskId(taskId);
    return taskId;
  }
  return null;
}
