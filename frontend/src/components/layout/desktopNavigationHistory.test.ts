import { describe, expect, it } from 'vitest';
import {
  createDesktopNavigationHistory,
  moveDesktopNavigation,
  pruneDesktopNavigationTabs,
  recordDesktopNavigation,
} from './desktopNavigationHistory';

describe('desktop navigation history', () => {
  it('records locations, ignores consecutive duplicates, and moves backward and forward', () => {
    let history = createDesktopNavigationHistory('workspace-1');
    history = recordDesktopNavigation(history, 'workspace-1', { view: 'data-loader' });
    history = recordDesktopNavigation(history, 'workspace-1', {
      view: 'token-frequency',
      tabId: 'tab-1',
    });
    expect(recordDesktopNavigation(history, 'workspace-1', history.entries[1]!)).toBe(history);

    const backward = moveDesktopNavigation(history, -1);
    expect(backward.location).toEqual({ view: 'data-loader' });
    const forward = moveDesktopNavigation(backward.history, 1);
    expect(forward.location).toEqual({ view: 'token-frequency', tabId: 'tab-1' });
  });

  it('truncates the forward trail when recording after moving back', () => {
    let history = createDesktopNavigationHistory('workspace-1');
    history = recordDesktopNavigation(history, 'workspace-1', { view: 'data-loader' });
    history = recordDesktopNavigation(history, 'workspace-1', { view: 'filter' });
    history = recordDesktopNavigation(history, 'workspace-1', { view: 'concordance', tabId: 'c' });
    history = moveDesktopNavigation(history, -1).history;
    history = recordDesktopNavigation(history, 'workspace-1', { view: 'export' });

    expect(history.entries).toEqual([
      { view: 'data-loader' },
      { view: 'filter' },
      { view: 'export' },
    ]);
    expect(moveDesktopNavigation(history, 1).location).toBeNull();
  });

  it('resets when the Workspace changes', () => {
    let history = recordDesktopNavigation(createDesktopNavigationHistory(), null, {
      view: 'data-loader',
    });
    history = recordDesktopNavigation(history, 'workspace-2', { view: 'filter' });
    expect(history).toEqual({
      workspaceId: 'workspace-2',
      entries: [{ view: 'filter' }],
      index: 0,
    });
  });

  it('prunes deleted Tabs while preserving the cursor position', () => {
    let history = createDesktopNavigationHistory('workspace-1');
    history = recordDesktopNavigation(history, 'workspace-1', { view: 'data-loader' });
    history = recordDesktopNavigation(history, 'workspace-1', {
      view: 'token-frequency',
      tabId: 'deleted',
    });
    history = recordDesktopNavigation(history, 'workspace-1', {
      view: 'concordance',
      tabId: 'kept',
    });
    history = moveDesktopNavigation(history, -1).history;

    expect(pruneDesktopNavigationTabs(history, new Set(['kept']))).toEqual({
      workspaceId: 'workspace-1',
      entries: [{ view: 'data-loader' }, { view: 'concordance', tabId: 'kept' }],
      index: 0,
    });
  });
});
