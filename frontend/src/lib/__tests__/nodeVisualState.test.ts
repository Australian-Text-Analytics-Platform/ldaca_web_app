import { describe, expect, it } from 'vitest';
import { DEFAULT_GREY_PAIR } from '../color';
import { PER_VIEW_ACTIVE_LIMIT, activeSetForContext, nodeVisualInfo } from '../nodeVisualState';

/** Shared assigned-colour fixture used by visual-state tests that assert focus/active colours. */
const BASE_ASSIGNED = { 'n-a': '#2563eb', 'n-b': '#dc2626' };

describe('activeSetForContext', () => {
  it('returns up to N most-recent selections for capped views', () => {
    // Concordance: cap 2. Selection order [a, b, c]; latest two = b, c.
    const out = activeSetForContext({
      selectedNodeIds: ['n-a', 'n-b', 'n-c'],
      currentView: 'concordance',
      assignedColors: {},
    });
    expect(out.sort()).toEqual(['n-b', 'n-c'].sort());
  });

  it('returns all selections for uncapped views (Export)', () => {
    const out = activeSetForContext({
      selectedNodeIds: ['n-a', 'n-b', 'n-c', 'n-d'],
      currentView: 'export',
      assignedColors: {},
    });
    expect(out.sort()).toEqual(['n-a', 'n-b', 'n-c', 'n-d'].sort());
  });

  it('returns only the latest one for single-node views', () => {
    for (const view of ['quotation', 'ai-annotator', 'analysis'] as const) {
      const out = activeSetForContext({
        selectedNodeIds: ['older', 'newer'],
        currentView: view,
        assignedColors: {},
      });
      expect(out).toEqual(['newer']);
    }
  });

  it('returns an empty array when nothing is selected', () => {
    const out = activeSetForContext({
      selectedNodeIds: [],
      currentView: 'concordance',
      assignedColors: {},
    });
    expect(out).toEqual([]);
  });
});

describe('nodeVisualInfo', () => {
  it('unselected node returns ``unselected`` + grey pair when no assigned colour', () => {
    const info = nodeVisualInfo('n-c', {
      selectedNodeIds: ['n-a'],
      currentView: 'concordance',
      assignedColors: {},
    });
    expect(info.state).toBe('unselected');
    expect(info.pair).toEqual(DEFAULT_GREY_PAIR);
  });

  it('unselected node returns its assigned colour pair when one exists', () => {
    const info = nodeVisualInfo('n-a', {
      selectedNodeIds: [],
      currentView: 'concordance',
      assignedColors: BASE_ASSIGNED,
    });
    expect(info.state).toBe('unselected');
    expect(info.pair.X).toBe('#2563eb');
    expect(info.pair.Y).not.toBe('#2563eb');
  });

  it('selected node within the active window returns ``active``', () => {
    const info = nodeVisualInfo('n-b', {
      selectedNodeIds: ['n-a', 'n-b'],
      currentView: 'concordance',
      assignedColors: BASE_ASSIGNED,
    });
    expect(info.state).toBe('active');
  });

  it('selected node bumped out of the active window returns ``focus``', () => {
    // concordance cap 2, three selected → oldest is focus.
    const info = nodeVisualInfo('n-a', {
      selectedNodeIds: ['n-a', 'n-b', 'n-c'],
      currentView: 'concordance',
      assignedColors: BASE_ASSIGNED,
    });
    expect(info.state).toBe('focus');
  });

  it('uncapped views always return ``active`` for any selected node', () => {
    for (const id of ['n-a', 'n-b', 'n-c', 'n-d']) {
      const info = nodeVisualInfo(id, {
        selectedNodeIds: ['n-a', 'n-b', 'n-c', 'n-d'],
        currentView: 'export',
        assignedColors: BASE_ASSIGNED,
      });
      expect(info.state).toBe('active');
    }
  });

  it('single-node views ``focus`` everything except the most-recent selection', () => {
    const ctx = {
      selectedNodeIds: ['old', 'newer'],
      currentView: 'quotation' as const,
      assignedColors: {},
    };
    expect(nodeVisualInfo('newer', ctx).state).toBe('active');
    expect(nodeVisualInfo('old', ctx).state).toBe('focus');
  });

  it('the assigned colour is preserved verbatim as ``pair.X``', () => {
    const info = nodeVisualInfo('n-a', {
      selectedNodeIds: ['n-a'],
      currentView: 'concordance',
      assignedColors: { 'n-a': '#abcdef' },
    });
    expect(info.pair.X).toBe('#abcdef');
  });
});

describe('PER_VIEW_ACTIVE_LIMIT shape', () => {
  it('covers every ViewType from the UI store', () => {
    // Cross-check: every ViewType entry has a numeric or "all" limit.
    const expectedKeys = [
      'data-loader',
      'filter',
      'token-frequency',
      'concordance',
      'analysis',
      'topic-modeling',
      'quotation',
      'ai-annotator',
      'export',
    ];
    for (const key of expectedKeys) {
      const value = (PER_VIEW_ACTIVE_LIMIT as Record<string, number | 'all'>)[key];
      expect(value === 'all' || typeof value === 'number').toBe(true);
    }
  });
});
