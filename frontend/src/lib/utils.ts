import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const mergeClasses = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'heading-1',
            'heading-2',
            'heading-3',
            'body',
            'body-secondary',
            'label',
            'label-secondary',
            'badge',
          ],
        },
      ],
    },
  },
});

/** Merges conditional class values while resolving Tailwind utility conflicts. */
/** Shared by layout, UI primitives, hints, analysis panels, and workspace views. */
export function cn(...inputs: ClassValue[]) {
  return mergeClasses(clsx(inputs));
}
