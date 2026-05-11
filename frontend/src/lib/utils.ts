import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a byte count using SI units (1000-based, matching disk/network UX).
 * Returns "0 bytes" for non-positive values; one decimal for sub-10 values
 * above the bytes range.
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 bytes';
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
  const value = bytes / Math.pow(1000, idx);
  return `${value < 10 && idx > 0 ? value.toFixed(1) : Math.round(value)} ${units[idx]}`;
}
