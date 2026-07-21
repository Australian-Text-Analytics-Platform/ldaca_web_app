import { describe, expect, it } from 'vitest';

import {
  getActiveTabId,
  getTabInputSet,
  getTabSetting,
  getTabs,
  reorderTabs,
  tabFromResource,
} from '../tabStateOps';

const tab = {
  id: 'tab-1',
  name: 'Analysis',
  kind: 'concordance' as const,
  analysis_id: 'analysis-1',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  revision: 2,
};

describe('tabStateOps', () => {
  it('projects server identity while preserving frontend-only draft state', () => {
    const projected = tabFromResource(tab, {
      title: 'Local title',
      input_sets: { source: [{ node_id: 'node-1', column: 'text' }] },
      settings: { mode: 'manual' },
    });
    expect(projected).toMatchObject({
      tab_id: 'tab-1',
      task_id: 'analysis-1',
      title: 'Local title',
      kind: 'concordance',
      settings: { mode: 'manual' },
    });
  });

  it('resolves groups, active ids, named inputs, and settings without server persistence', () => {
    const projected = tabFromResource(tab, {
      input_sets: { source: [{ node_id: 'node-1', column: 'text' }] },
      settings: { mode: 'manual' },
    });
    const state = { groups: { concordance: { tabs: [projected], active_tab_id: 'tab-1' } } };
    expect(getTabs(state, 'concordance')).toEqual([projected]);
    expect(getActiveTabId(state, 'concordance')).toBe('tab-1');
    expect(getTabInputSet(projected, 'source')).toEqual([{ node_id: 'node-1', column: 'text' }]);
    expect(getTabSetting(projected, 'mode')).toBe('manual');
    expect(getTabSetting(projected, 'missing')).toBeUndefined();
  });

  it('reorders known tabs and appends omitted tabs without changing identity', () => {
    const first = tabFromResource(tab);
    const second = tabFromResource({ ...tab, id: 'tab-2', name: 'Second', analysis_id: null });
    expect(reorderTabs([first, second], ['tab-2']).map((item) => item.tab_id)).toEqual([
      'tab-2',
      'tab-1',
    ]);
  });
});
