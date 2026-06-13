import { useResizableSplit } from '@/hooks/useResizableSplit';
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from '@/config/layout';

/**
 * Pixel-based sidebar resize hook that mutates shadcn's sidebar-gap and
 * sidebar-container DOM elements during drag so React stays off the
 * per-frame render path.
 */
export const useSidebarResize = () => {
  return useResizableSplit({
    orientation: 'vertical',
    mode: 'pixel',
    defaultValue: SIDEBAR_DEFAULT_WIDTH,
    min: SIDEBAR_MIN_WIDTH,
    max: SIDEBAR_MAX_WIDTH,
    persistKey: 'ldaca.layout.sidebarWidth',
    onDragStart: () => {
      const gapEl = document.querySelector<HTMLElement>('[data-slot="sidebar-gap"]');
      const containerEl = document.querySelector<HTMLElement>('[data-slot="sidebar-container"]');
      if (gapEl) gapEl.style.transition = 'none';
      if (containerEl) containerEl.style.transition = 'none';
    },
    onLiveUpdate: (next) => {
      const gapEl = document.querySelector<HTMLElement>('[data-slot="sidebar-gap"]');
      const containerEl = document.querySelector<HTMLElement>('[data-slot="sidebar-container"]');
      if (gapEl) gapEl.style.width = `${String(next)}px`;
      if (containerEl) containerEl.style.width = `${String(next)}px`;
    },
    onDragEnd: () => {
      const gapEl = document.querySelector<HTMLElement>('[data-slot="sidebar-gap"]');
      const containerEl = document.querySelector<HTMLElement>('[data-slot="sidebar-container"]');
      if (gapEl) {
        gapEl.style.transition = '';
        gapEl.style.width = '';
      }
      if (containerEl) {
        containerEl.style.transition = '';
        containerEl.style.width = '';
      }
    },
  });
};
