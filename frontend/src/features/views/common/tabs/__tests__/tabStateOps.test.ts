import { describe, expect, it } from 'vitest';

import {
  closeTabInState,
  countTabsRemovedBySingleTabMode,
  createTabInState,
  getActiveTabId,
  getTabInputSet,
  getTabs,
  keepFirstTabInState,
  renameTabInState,
  reorderTabsInState,
  setActiveTabInState,
  setTabInputSetInState,
  setTabInputsInState,
  setTabTaskInState,
} from '../tabStateOps';

const TYPE = 'concordance_analysis';
const OTHER = 'token_frequency_analysis';

describe('tabStateOps', () => {
  it('creates a tab, focuses it, and returns its id', () => {
    const { state, tabId } = createTabInState(null, TYPE, 'Analysis 1', 'a');
    expect(tabId).toBe('a');
    expect(getTabs(state, TYPE)).toHaveLength(1);
    expect(getTabs(state, TYPE)[0]).toMatchObject({
      tab_id: 'a',
      task_id: null,
      title: 'Analysis 1',
    });
    expect(getActiveTabId(state, TYPE)).toBe('a');
  });

  it('keeps other analysis-type groups intact when mutating one group', () => {
    let state = createTabInState(null, TYPE, 'A', 'a').state;
    state = createTabInState(state, OTHER, 'B', 'b').state;
    state = createTabInState(state, TYPE, 'A2', 'a2').state;
    expect(getTabs(state, TYPE).map((t) => t.tab_id)).toEqual(['a', 'a2']);
    expect(getTabs(state, OTHER).map((t) => t.tab_id)).toEqual(['b']);
  });

  it('reselects the previous tab when the active tab is closed', () => {
    let state = createTabInState(null, TYPE, 'A', 'a').state;
    state = createTabInState(state, TYPE, 'B', 'b').state;
    state = createTabInState(state, TYPE, 'C', 'c').state; // active = c
    state = closeTabInState(state, TYPE, 'c');
    expect(getActiveTabId(state, TYPE)).toBe('b');
    expect(getTabs(state, TYPE).map((t) => t.tab_id)).toEqual(['a', 'b']);
  });

  it('clears the active id when the last tab is closed', () => {
    let state = createTabInState(null, TYPE, 'A', 'a').state;
    state = closeTabInState(state, TYPE, 'a');
    expect(getTabs(state, TYPE)).toHaveLength(0);
    expect(getActiveTabId(state, TYPE)).toBeNull();
  });

  it('does not change the active id when closing a non-active tab', () => {
    let state = createTabInState(null, TYPE, 'A', 'a').state;
    state = createTabInState(state, TYPE, 'B', 'b').state; // active = b
    state = closeTabInState(state, TYPE, 'a');
    expect(getActiveTabId(state, TYPE)).toBe('b');
  });

  it('keeps only the first tab and makes it active', () => {
    let state = createTabInState(null, TYPE, 'A', 'a').state;
    state = createTabInState(state, TYPE, 'B', 'b').state;
    state = createTabInState(state, TYPE, 'C', 'c').state; // active = c
    state = keepFirstTabInState(state, TYPE);
    expect(getTabs(state, TYPE).map((t) => t.tab_id)).toEqual(['a']);
    expect(getActiveTabId(state, TYPE)).toBe('a');
  });

  it('counts tabs that single-tab mode would remove across groups', () => {
    let state = createTabInState(null, TYPE, 'A', 'a').state;
    state = createTabInState(state, TYPE, 'B', 'b').state;
    state = createTabInState(state, OTHER, 'C', 'c').state;
    state = createTabInState(state, OTHER, 'D', 'd').state;
    state = createTabInState(state, OTHER, 'E', 'e').state;

    expect(countTabsRemovedBySingleTabMode(state)).toBe(3);
  });

  it('renames a tab title', () => {
    let state = createTabInState(null, TYPE, 'A', 'a').state;
    state = renameTabInState(state, TYPE, 'a', 'Renamed');
    expect(getTabs(state, TYPE)[0]!.title).toBe('Renamed');
  });

  it('sets the active tab and ignores unknown ids', () => {
    let state = createTabInState(null, TYPE, 'A', 'a').state;
    state = createTabInState(state, TYPE, 'B', 'b').state;
    state = setActiveTabInState(state, TYPE, 'a');
    expect(getActiveTabId(state, TYPE)).toBe('a');
    state = setActiveTabInState(state, TYPE, 'missing');
    expect(getActiveTabId(state, TYPE)).toBe('a');
  });

  it('sets and clears a tab task id', () => {
    let state = createTabInState(null, TYPE, 'A', 'a').state;
    state = setTabTaskInState(state, TYPE, 'a', 'task-123');
    expect(getTabs(state, TYPE)[0]!.task_id).toBe('task-123');
    state = setTabTaskInState(state, TYPE, 'a', null);
    expect(getTabs(state, TYPE)[0]!.task_id).toBeNull();
  });

  it('creates new tabs without copying an existing tab task or inputs', () => {
    let state = createTabInState(null, TYPE, 'A', 'a').state;
    state = setTabTaskInState(state, TYPE, 'a', 'task-123');
    state = setTabInputsInState(state, TYPE, 'a', [{ node_id: 'node-1', column: 'text' }]);

    state = createTabInState(state, TYPE, 'B', 'b').state;

    expect(getTabs(state, TYPE)[0]).toMatchObject({
      tab_id: 'a',
      task_id: 'task-123',
      inputs: [{ node_id: 'node-1', column: 'text' }],
    });
    expect(getTabs(state, TYPE)[1]).toMatchObject({
      tab_id: 'b',
      task_id: null,
      inputs: [],
    });
    expect(getActiveTabId(state, TYPE)).toBe('b');
  });

  it('stores multiple named input sets while keeping legacy inputs as the source selector', () => {
    let state = createTabInState(null, TYPE, 'A', 'a').state;
    const sourceInputs = [{ node_id: 'source-node', column: 'text' }];
    const classInputs = [{ node_id: 'class-node', column: 'class' }];

    state = setTabInputsInState(state, TYPE, 'a', sourceInputs);
    state = setTabInputSetInState(state, TYPE, 'a', 'classDescriptions', classInputs);

    expect(getTabs(state, TYPE)[0]).toMatchObject({
      inputs: sourceInputs,
      input_sets: {
        source: sourceInputs,
        classDescriptions: classInputs,
      },
    });
  });

  it('resolves named input sets with a legacy source fallback', () => {
    const legacyTab = {
      tab_id: 'legacy',
      task_id: null,
      title: 'Legacy',
      inputs: [{ node_id: 'source-node', column: 'text' }],
    };
    const namedTab = {
      ...legacyTab,
      input_sets: {
        source: [{ node_id: 'named-source-node', column: 'text' }],
        classDescriptions: [{ node_id: 'class-node', column: 'class' }],
      },
    };

    expect(getTabInputSet(legacyTab, 'source')).toEqual([
      { node_id: 'source-node', column: 'text' },
    ]);
    expect(getTabInputSet(namedTab, 'source')).toEqual([
      { node_id: 'named-source-node', column: 'text' },
    ]);
    expect(getTabInputSet(namedTab, 'classDescriptions')).toEqual([
      { node_id: 'class-node', column: 'class' },
    ]);
    expect(getTabInputSet(namedTab, 'missing')).toEqual([]);
  });

  it('falls back to the first tab when active_tab_id is dangling', () => {
    let state = createTabInState(null, TYPE, 'A', 'a').state;
    state = createTabInState(state, TYPE, 'B', 'b').state;
    // Simulate a stale active pointer.
    state = { groups: { [TYPE]: { tabs: getTabs(state, TYPE), active_tab_id: 'gone' } } };
    expect(getActiveTabId(state, TYPE)).toBe('a');
  });

  it('reorders a tab to the drop target position without changing the active tab', () => {
    let state = createTabInState(null, TYPE, 'A', 'a').state;
    state = createTabInState(state, TYPE, 'B', 'b').state;
    state = createTabInState(state, TYPE, 'C', 'c').state; // active = c
    state = reorderTabsInState(state, TYPE, ['b', 'c', 'a']);
    expect(getTabs(state, TYPE).map((t) => t.tab_id)).toEqual(['b', 'c', 'a']);
    expect(getActiveTabId(state, TYPE)).toBe('c');
  });

  it('keeps omitted tabs and is a no-op for an unchanged order', () => {
    let state = createTabInState(null, TYPE, 'A', 'a').state;
    state = createTabInState(state, TYPE, 'B', 'b').state;
    // Omitting 'b' keeps it appended at the end rather than dropping it.
    expect(getTabs(reorderTabsInState(state, TYPE, ['a']), TYPE).map((t) => t.tab_id)).toEqual([
      'a',
      'b',
    ]);
    // Same order leaves the tab sequence unchanged.
    expect(getTabs(reorderTabsInState(state, TYPE, ['a', 'b']), TYPE).map((t) => t.tab_id)).toEqual(
      ['a', 'b'],
    );
  });
});
