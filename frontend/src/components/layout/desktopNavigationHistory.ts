import type { ViewType } from '@/features/views/viewIds';

export interface DesktopNavigationLocation {
  view: ViewType;
  tabId?: string;
}

export interface DesktopNavigationHistory {
  workspaceId: string | null;
  entries: DesktopNavigationLocation[];
  index: number;
}

export const createDesktopNavigationHistory = (
  workspaceId: string | null = null,
): DesktopNavigationHistory => ({ workspaceId, entries: [], index: -1 });

const locationsEqual = (
  left: DesktopNavigationLocation | undefined,
  right: DesktopNavigationLocation | undefined,
): boolean => left?.view === right?.view && left?.tabId === right?.tabId;

export function recordDesktopNavigation(
  history: DesktopNavigationHistory,
  workspaceId: string | null,
  location: DesktopNavigationLocation,
): DesktopNavigationHistory {
  if (history.workspaceId !== workspaceId) {
    return { workspaceId, entries: [location], index: 0 };
  }
  if (locationsEqual(history.entries[history.index], location)) return history;
  const entries = [...history.entries.slice(0, history.index + 1), location];
  return { ...history, entries, index: entries.length - 1 };
}

export function moveDesktopNavigation(
  history: DesktopNavigationHistory,
  direction: -1 | 1,
): { history: DesktopNavigationHistory; location: DesktopNavigationLocation | null } {
  const nextIndex = history.index + direction;
  const location = history.entries[nextIndex];
  if (!location) return { history, location: null };
  return { history: { ...history, index: nextIndex }, location };
}

export function pruneDesktopNavigationTabs(
  history: DesktopNavigationHistory,
  validTabIds: ReadonlySet<string>,
): DesktopNavigationHistory {
  const retained = history.entries
    .map((location, originalIndex) => ({ location, originalIndex }))
    .filter(({ location }) => !location.tabId || validTabIds.has(location.tabId));
  const entries = retained.map(({ location }) => location);
  const index = retained.filter(({ originalIndex }) => originalIndex <= history.index).length - 1;
  if (entries.length === history.entries.length && index === history.index) return history;
  return { ...history, entries, index };
}
