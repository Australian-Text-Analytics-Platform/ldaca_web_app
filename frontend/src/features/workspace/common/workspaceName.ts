export const getInvalidWorkspaceNameMessage = (error: unknown): string | null => {
  const rawMessage = (error as { message?: unknown })?.message;
  if (typeof rawMessage === 'string' && rawMessage.toLowerCase().includes('invalid workspace name')) {
    return rawMessage;
  }

  const detail = (error as { detail?: unknown })?.detail;
  if (detail && typeof detail === 'object') {
    const detailMessage = (detail as { detail?: unknown; message?: unknown })?.detail
      ?? (detail as { message?: unknown })?.message;
    if (typeof detailMessage === 'string' && detailMessage.toLowerCase().includes('invalid workspace name')) {
      return detailMessage;
    }
  }

  return null;
};
