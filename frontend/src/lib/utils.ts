import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges conditional class values while resolving Tailwind utility conflicts. */
/** Used by: src/components/layout/InsetCard.tsx, src/components/layout/Sidebar.tsx, src/components/layout/WorkspaceNodeList.tsx and 48 other importers because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
