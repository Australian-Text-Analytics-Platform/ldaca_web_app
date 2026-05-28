import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges conditional class values while resolving Tailwind utility conflicts. */
/** Used by: src/components/layout/InsetCard.tsx, src/components/layout/Sidebar.tsx, src/components/layout/sidebar/SidebarNodesSection.tsx and 48 other importers because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a byte count using SI units (1000-based, matching disk/network UX).
 * Returns "0 bytes" for non-positive values; one decimal for sub-10 values
 * above the bytes range.
 */
/**
 * Used by: src/features/analysis/topic-modeling/components/ClearEmbeddingCacheMenuItem.tsx, src/features/data-loader/components/ActiveWorkspaceCard.tsx, src/features/data-loader/components/FileTree.tsx and 2 other importers because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 bytes';
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
  const value = bytes / Math.pow(1000, idx);
  return `${value < 10 && idx > 0 ? value.toFixed(1) : Math.round(value)} ${units[idx]}`;
}
