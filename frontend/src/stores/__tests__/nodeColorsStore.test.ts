import { beforeEach, describe, expect, it } from 'vitest';
import { EXTENDED_PALETTE, UNASSIGNED_NODE_COLOR } from '@/features/views/common/palette';
import { useNodeColorsStore } from '../nodeColorsStore';

describe('useNodeColorsStore — assigned-only paths', () => {
  beforeEach(() => {
    useNodeColorsStore.getState().reset();
  });

  it('ensureColors assigns palette colours in insertion order', () => {
    useNodeColorsStore.getState().ensureColors(['a', 'b']);
    const { colors } = useNodeColorsStore.getState();
    expect(colors.a).toBe(EXTENDED_PALETTE[0]);
    expect(colors.b).toBe(EXTENDED_PALETTE[1]);
  });

  it('ensureColors is idempotent for already-assigned nodes', () => {
    useNodeColorsStore.getState().ensureColors(['a']);
    const before = useNodeColorsStore.getState().colors.a;
    useNodeColorsStore.getState().ensureColors(['a']);
    expect(useNodeColorsStore.getState().colors.a).toBe(before);
  });

  it('setColor writes through to the assigned map and tracks insertion order', () => {
    useNodeColorsStore.getState().setColor('a', '#abcdef');
    expect(useNodeColorsStore.getState().colors.a).toBe('#abcdef');
    expect(useNodeColorsStore.getState().assignmentOrder).toContain('a');
  });

  it('ensureColors never auto-assigns UNASSIGNED_NODE_COLOR even past one full palette cycle', () => {
    // Grey doubles as the "no colour" indicator, so the auto-assign
    // palette excludes it. Walking through 24 nodes — twice the
    // palette length — must never produce a grey assignment.
    const ids = Array.from({ length: 24 }, (_, i) => `n${i}`);
    useNodeColorsStore.getState().ensureColors(ids);
    const { colors } = useNodeColorsStore.getState();
    for (const id of ids) {
      expect(colors[id]).not.toBe(UNASSIGNED_NODE_COLOR);
    }
  });

  it('setColor still accepts UNASSIGNED_NODE_COLOR — manual picks bypass the auto-roll filter', () => {
    useNodeColorsStore.getState().setColor('a', UNASSIGNED_NODE_COLOR);
    expect(useNodeColorsStore.getState().colors.a).toBe(UNASSIGNED_NODE_COLOR);
  });
});

describe('useNodeColorsStore — per-tab temp layer', () => {
  beforeEach(() => {
    useNodeColorsStore.getState().reset();
  });

  it('ensureTempColors seeds temps from EXTENDED_PALETTE on first call', () => {
    useNodeColorsStore.getState().ensureTempColors('concordance', ['a', 'b']);
    const { temps, colors } = useNodeColorsStore.getState();
    expect(temps.concordance?.a).toBeDefined();
    expect(temps.concordance?.b).toBeDefined();
    // Temps do NOT bleed into the assigned map.
    expect(colors).toEqual({});
  });

  it('ensureTempColors picks distinct colours across nodes in one tab', () => {
    useNodeColorsStore.getState().ensureTempColors('concordance', ['a', 'b', 'c']);
    const tab = useNodeColorsStore.getState().temps.concordance ?? {};
    const used = new Set(Object.values(tab));
    expect(used.size).toBe(3);
  });

  it('ensureTempColors never rolls UNASSIGNED_NODE_COLOR via the random path', () => {
    // Seed assigned with a non-grey colour so the random roll path
    // fires (not the "prefer assigned" short-circuit), then verify
    // grey never lands on any of a large batch of nodes.
    const ids = Array.from({ length: 50 }, (_, i) => `n${i}`);
    useNodeColorsStore.getState().ensureTempColors('concordance', ids);
    const tab = useNodeColorsStore.getState().temps.concordance ?? {};
    for (const id of ids) {
      expect(tab[id]).not.toBe(UNASSIGNED_NODE_COLOR);
    }
  });

  it("ensureTempColors prefers a node's existing assigned colour as the starting temp", () => {
    useNodeColorsStore.getState().setColor('a', '#2563eb');
    useNodeColorsStore.getState().ensureTempColors('concordance', ['a']);
    expect(useNodeColorsStore.getState().temps.concordance?.a).toBe('#2563eb');
  });

  it('ensureTempColors avoids re-using an already-visible colour when seeding a second node', () => {
    useNodeColorsStore.getState().setColor('a', '#2563eb'); // visible via assigned
    useNodeColorsStore.getState().ensureTempColors('concordance', ['a', 'b']);
    const tabTemps = useNodeColorsStore.getState().temps.concordance ?? {};
    expect(tabTemps.a).toBe('#2563eb');
    expect(tabTemps.b).not.toBe('#2563eb');
  });

  it("setTempColor writes manual picks into the tab's temp layer (not assigned)", () => {
    useNodeColorsStore.getState().setTempColor('concordance', 'a', '#dc2626');
    expect(useNodeColorsStore.getState().temps.concordance?.a).toBe('#dc2626');
    expect(useNodeColorsStore.getState().colors.a).toBeUndefined();
  });

  it('clearTempColors removes the listed nodeIds from a tab', () => {
    useNodeColorsStore.getState().ensureTempColors('concordance', ['a', 'b']);
    useNodeColorsStore.getState().clearTempColors('concordance', ['a']);
    const tabTemps = useNodeColorsStore.getState().temps.concordance ?? {};
    expect(tabTemps.a).toBeUndefined();
    expect(tabTemps.b).toBeDefined();
  });

  it('clearTempColors with no nodeIds clears the entire tab', () => {
    useNodeColorsStore.getState().ensureTempColors('concordance', ['a', 'b']);
    useNodeColorsStore.getState().clearTempColors('concordance');
    expect(useNodeColorsStore.getState().temps.concordance).toBeUndefined();
  });

  it('per-tab temp layers are independent (Concordance temp does not leak into Frequency)', () => {
    useNodeColorsStore.getState().setTempColor('concordance', 'a', '#2563eb');
    useNodeColorsStore.getState().setTempColor('token-frequency', 'a', '#dc2626');
    expect(useNodeColorsStore.getState().temps.concordance?.a).toBe('#2563eb');
    expect(useNodeColorsStore.getState().temps['token-frequency']?.a).toBe('#dc2626');
  });

  it('promoteTempColors commits temps to assigned for the listed nodes', () => {
    useNodeColorsStore.getState().setTempColor('concordance', 'a', '#2563eb');
    useNodeColorsStore.getState().setTempColor('concordance', 'b', '#dc2626');
    useNodeColorsStore.getState().promoteTempColors('concordance', ['a']);
    const { colors, temps } = useNodeColorsStore.getState();
    expect(colors.a).toBe('#2563eb');
    expect(colors.b).toBeUndefined();
    // Promoted temp cleared from the tab layer; the unpromoted one stays.
    expect(temps.concordance?.a).toBeUndefined();
    expect(temps.concordance?.b).toBe('#dc2626');
  });

  it("promoteTempColors does NOT touch other tabs' temps", () => {
    useNodeColorsStore.getState().setTempColor('concordance', 'a', '#2563eb');
    useNodeColorsStore.getState().setTempColor('token-frequency', 'a', '#dc2626');
    useNodeColorsStore.getState().promoteTempColors('concordance', ['a']);
    // assigned reflects the concordance temp; token-frequency temp persists.
    expect(useNodeColorsStore.getState().colors.a).toBe('#2563eb');
    expect(useNodeColorsStore.getState().temps['token-frequency']?.a).toBe('#dc2626');
  });

  it('promoteTempColors is a no-op when there are no temps for the nodeIds', () => {
    useNodeColorsStore.getState().promoteTempColors('concordance', ['a']);
    expect(useNodeColorsStore.getState().colors.a).toBeUndefined();
  });
});

describe('useNodeColorsStore — hydrateColors', () => {
  beforeEach(() => {
    useNodeColorsStore.getState().reset();
  });

  it('replaces the existing colour map wholesale', () => {
    useNodeColorsStore.getState().setColor('stale', '#000000');
    useNodeColorsStore.getState().hydrateColors({ fresh: '#2563eb' });
    expect(useNodeColorsStore.getState().colors).toEqual({ fresh: '#2563eb' });
  });

  it('resets assignmentOrder to the keys of the hydrated payload', () => {
    useNodeColorsStore.getState().setColor('stale', '#000000');
    useNodeColorsStore.getState().hydrateColors({ a: '#2563eb', b: '#dc2626' });
    expect(useNodeColorsStore.getState().assignmentOrder.sort()).toEqual(['a', 'b']);
  });

  it('does not touch the per-tab temp layer', () => {
    useNodeColorsStore.getState().setTempColor('concordance', 'x', '#16a34a');
    useNodeColorsStore.getState().hydrateColors({ x: '#2563eb' });
    expect(useNodeColorsStore.getState().temps.concordance?.x).toBe('#16a34a');
  });

  it('an empty hydration clears the assigned map', () => {
    useNodeColorsStore.getState().setColor('a', '#2563eb');
    useNodeColorsStore.getState().hydrateColors({});
    expect(useNodeColorsStore.getState().colors).toEqual({});
    expect(useNodeColorsStore.getState().assignmentOrder).toEqual([]);
  });
});

describe('useNodeColorsStore — pruneStaleColors', () => {
  beforeEach(() => {
    useNodeColorsStore.getState().reset();
  });

  it('drops assigned colours for nodes not in the active set', () => {
    useNodeColorsStore.getState().setColor('a', '#2563eb');
    useNodeColorsStore.getState().setColor('b', '#dc2626');
    useNodeColorsStore.getState().pruneStaleColors(['a']);
    expect(useNodeColorsStore.getState().colors).toEqual({ a: '#2563eb' });
  });

  it('also drops the swept ids from assignmentOrder', () => {
    useNodeColorsStore.getState().setColor('a', '#2563eb');
    useNodeColorsStore.getState().setColor('b', '#dc2626');
    useNodeColorsStore.getState().pruneStaleColors(['a']);
    expect(useNodeColorsStore.getState().assignmentOrder).toEqual(['a']);
  });

  it('drops per-tab temp entries for swept nodes', () => {
    useNodeColorsStore.getState().setTempColor('concordance', 'a', '#2563eb');
    useNodeColorsStore.getState().setTempColor('concordance', 'b', '#dc2626');
    useNodeColorsStore.getState().setTempColor('token-frequency', 'b', '#16a34a');
    useNodeColorsStore.getState().pruneStaleColors(['a']);
    expect(useNodeColorsStore.getState().temps.concordance?.a).toBe('#2563eb');
    expect(useNodeColorsStore.getState().temps.concordance?.b).toBeUndefined();
    expect(useNodeColorsStore.getState().temps['token-frequency']?.b).toBeUndefined();
  });

  it('is a no-op when every store entry is alive', () => {
    useNodeColorsStore.getState().setColor('a', '#2563eb');
    const before = useNodeColorsStore.getState().colors;
    useNodeColorsStore.getState().pruneStaleColors(['a', 'b']);
    // Reference equality — no-op should NOT clone the colours object.
    expect(useNodeColorsStore.getState().colors).toBe(before);
  });

  it('does not assign a colour to a live nodeId that was missing before', () => {
    // Sweep is one-way (drops), never seeds. ``ensureColors`` is the
    // one that hands out new colours; this test guards against
    // confusion between the two.
    useNodeColorsStore.getState().pruneStaleColors(['a']);
    expect(useNodeColorsStore.getState().colors.a).toBeUndefined();
  });

  it('sweeping with an empty active set drops everything', () => {
    useNodeColorsStore.getState().setColor('a', '#2563eb');
    useNodeColorsStore.getState().setTempColor('concordance', 'a', '#dc2626');
    useNodeColorsStore.getState().pruneStaleColors([]);
    expect(useNodeColorsStore.getState().colors).toEqual({});
    expect(useNodeColorsStore.getState().temps.concordance).toEqual({});
    expect(useNodeColorsStore.getState().assignmentOrder).toEqual([]);
  });
});
