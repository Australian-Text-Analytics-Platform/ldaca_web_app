/** Identifies native file drags without matching text, URL, or in-app drags. */
export function isExternalFileDrag(
  dataTransfer: Pick<DataTransfer, 'types'> | null | undefined,
): boolean {
  return Array.from(dataTransfer?.types ?? []).includes('Files');
}

/** Prevents the browser fallback only when no application drop target handled the file drag. */
export function blockUnhandledExternalFileDrop(event: DragEvent): void {
  if (event.defaultPrevented || !isExternalFileDrag(event.dataTransfer)) return;
  event.preventDefault();
}

/** Installs the window-level fallback after child drop targets have had the event first. */
export function installExternalFileDropGuard(target: Window): () => void {
  target.addEventListener('dragover', blockUnhandledExternalFileDrop);
  target.addEventListener('drop', blockUnhandledExternalFileDrop);

  return () => {
    target.removeEventListener('dragover', blockUnhandledExternalFileDrop);
    target.removeEventListener('drop', blockUnhandledExternalFileDrop);
  };
}
