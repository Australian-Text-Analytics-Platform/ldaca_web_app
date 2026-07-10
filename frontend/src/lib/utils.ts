import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges conditional class values while resolving Tailwind utility conflicts. */
/** Shared by layout, UI primitives, hints, analysis panels, and workspace views. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
