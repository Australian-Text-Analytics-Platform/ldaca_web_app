import { beforeEach, describe, expect, it } from 'vitest';
import { EXTENDED_PALETTE } from '@/features/analysis/common/palette';
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

  it('ensureTempColors prefers a node\'s existing assigned colour as the starting temp', () => {
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

  it('setTempColor writes manual picks into the tab\'s temp layer (not assigned)', () => {
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

  it('promoteTempColors does NOT touch other tabs\' temps', () => {
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

describe('useNodeColorsStore — Phase D manual-pick conflict avoidance', () => {
  beforeEach(() => {
    useNodeColorsStore.getState().reset();
  });

  it('a manual pick that clashes with another node\'s AUTO temp re-rolls the auto temp', () => {
    // Seed: both nodes get auto-rolled temps (distinct by design).
    useNodeColorsStore.getState().ensureTempColors('concordance', ['a', 'b']);
    const tabBefore = useNodeColorsStore.getState().temps.concordance ?? {};
    const colorB = tabBefore.b!;
    // User manually picks the same colour as B for A.
    useNodeColorsStore.getState().setTempColor('concordance', 'a', colorB);
    const tabAfter = useNodeColorsStore.getState().temps.concordance ?? {};
    expect(tabAfter.a).toBe(colorB);
    // B was auto-rolled → got re-rolled to something else.
    expect(tabAfter.b).not.toBe(colorB);
  });

  it('a manual pick that clashes with another node\'s MANUAL temp leaves it alone', () => {
    // User explicitly sets B to a specific colour first.
    useNodeColorsStore.getState().setTempColor('concordance', 'b', '#2563eb');
    // Then sets A to the same colour. Both stay (user wins, no re-roll
    // on top of an already-manual pick).
    useNodeColorsStore.getState().setTempColor('concordance', 'a', '#2563eb');
    const tab = useNodeColorsStore.getState().temps.concordance ?? {};
    expect(tab.a).toBe('#2563eb');
    expect(tab.b).toBe('#2563eb');
  });

  it('a manual pick on the same node re-writes that node\'s temp without re-rolling others', () => {
    useNodeColorsStore.getState().ensureTempColors('concordance', ['a', 'b']);
    const tabBefore = useNodeColorsStore.getState().temps.concordance ?? {};
    const originalB = tabBefore.b!;
    // User picks a brand-new colour for A that doesn't conflict.
    useNodeColorsStore.getState().setTempColor('concordance', 'a', '#92400e');
    expect(useNodeColorsStore.getState().temps.concordance?.b).toBe(originalB);
  });

  it('clearTempColors drops the manual flag along with the temp', () => {
    useNodeColorsStore.getState().setTempColor('concordance', 'a', '#2563eb');
    useNodeColorsStore.getState().clearTempColors('concordance', ['a']);
    // Re-seed an auto temp for A — it should be eligible for re-rolling
    // again (i.e. NOT treated as manual any more).
    useNodeColorsStore.getState().ensureTempColors('concordance', ['a']);
    useNodeColorsStore.getState().setTempColor('concordance', 'b', useNodeColorsStore.getState().temps.concordance?.a ?? '');
    // B's manual write should have re-rolled A's now-auto temp.
    const tab = useNodeColorsStore.getState().temps.concordance ?? {};
    expect(tab.a).not.toBe(tab.b);
  });

  it('promoteTempColors clears the manual flag (committed colours have no manual/auto distinction)', () => {
    useNodeColorsStore.getState().setTempColor('concordance', 'a', '#2563eb');
    useNodeColorsStore.getState().promoteTempColors('concordance', ['a']);
    expect(useNodeColorsStore.getState().colors.a).toBe('#2563eb');
    // After promotion, an auto-re-roll attempt on another node should
    // treat A as a normal assigned colour (visible in conflict-avoidance,
    // not flagged as manual). The presence/absence of A's manual flag
    // matters only for *temp-layer* conflict avoidance, which is empty
    // after promotion — sanity-check the post-state directly.
    const manual = useNodeColorsStore.getState().manualNodes.concordance ?? {};
    expect(manual.a).toBeUndefined();
  });

  it('manual-pick conflict avoidance is scoped to one tab — does not touch other tabs', () => {
    useNodeColorsStore.getState().ensureTempColors('concordance', ['a', 'b']);
    useNodeColorsStore.getState().ensureTempColors('token-frequency', ['a', 'b']);
    const freqB = useNodeColorsStore.getState().temps['token-frequency']?.b ?? '';
    // Manually pick freqB's colour for ``a`` in concordance — should
    // affect concordance only, leave token-frequency intact.
    useNodeColorsStore.getState().setTempColor('concordance', 'a', freqB);
    expect(useNodeColorsStore.getState().temps['token-frequency']?.b).toBe(freqB);
  });
});
