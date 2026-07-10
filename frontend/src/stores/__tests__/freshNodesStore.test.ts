import { beforeEach, describe, expect, it } from 'vitest';
import { useFreshNodesStore } from '../freshNodesStore';

describe('useFreshNodesStore', () => {
  beforeEach(() => {
    useFreshNodesStore.getState().reset();
  });

  it('first observation does NOT mark anything fresh', () => {
    useFreshNodesStore.getState().observeNodeIds('workspace-a', ['a', 'b', 'c']);
    const freshness = useFreshNodesStore.getState().freshnessByWorkspace.get('workspace-a');
    expect(freshness?.seenIds).toEqual(new Set(['a', 'b', 'c']));
    expect(freshness?.freshIds).toEqual(new Set());
  });

  it('subsequent observation marks new ids as fresh, leaves existing ones alone', () => {
    useFreshNodesStore.getState().observeNodeIds('workspace-a', ['a', 'b']);
    useFreshNodesStore.getState().observeNodeIds('workspace-a', ['a', 'b', 'c']);
    expect(
      useFreshNodesStore.getState().freshnessByWorkspace.get('workspace-a')?.freshIds,
    ).toEqual(new Set(['c']));
  });

  it('multiple new arrivals in one observation all get marked fresh', () => {
    useFreshNodesStore.getState().observeNodeIds('workspace-a', ['a']);
    useFreshNodesStore.getState().observeNodeIds('workspace-a', ['a', 'b', 'c']);
    expect(
      useFreshNodesStore.getState().freshnessByWorkspace.get('workspace-a')?.freshIds,
    ).toEqual(new Set(['b', 'c']));
  });

  it('observation is idempotent for already-seen ids', () => {
    useFreshNodesStore.getState().observeNodeIds('workspace-a', ['a', 'b']);
    useFreshNodesStore.getState().observeNodeIds('workspace-a', ['a', 'b']);
    expect(
      useFreshNodesStore.getState().freshnessByWorkspace.get('workspace-a')?.freshIds,
    ).toEqual(new Set());
  });

  it('markInteracted clears the given fresh ids', () => {
    useFreshNodesStore.getState().observeNodeIds('workspace-a', ['a']);
    useFreshNodesStore.getState().observeNodeIds('workspace-a', ['a', 'b', 'c']);
    useFreshNodesStore.getState().markInteracted('workspace-a', ['b']);
    expect(
      useFreshNodesStore.getState().freshnessByWorkspace.get('workspace-a')?.freshIds,
    ).toEqual(new Set(['c']));
  });

  it('markInteracted is a no-op for ids not currently fresh', () => {
    useFreshNodesStore.getState().observeNodeIds('workspace-a', ['a', 'b']);
    useFreshNodesStore.getState().markInteracted('workspace-a', ['a']);
    const freshness = useFreshNodesStore.getState().freshnessByWorkspace.get('workspace-a');
    expect(freshness?.freshIds).toEqual(new Set());
    expect(freshness?.seenIds).toEqual(new Set(['a', 'b']));
  });

  it('tracks overlapping node ids independently for each workspace', () => {
    useFreshNodesStore.getState().observeNodeIds('workspace-a', ['shared']);
    useFreshNodesStore.getState().observeNodeIds('workspace-a', ['shared', 'workspace-a-new']);
    useFreshNodesStore.getState().observeNodeIds('workspace-b', ['shared']);
    useFreshNodesStore.getState().observeNodeIds('workspace-b', ['shared', 'workspace-b-new']);

    expect(
      useFreshNodesStore.getState().freshnessByWorkspace.get('workspace-a')?.freshIds,
    ).toEqual(new Set(['workspace-a-new']));
    expect(
      useFreshNodesStore.getState().freshnessByWorkspace.get('workspace-b')?.freshIds,
    ).toEqual(new Set(['workspace-b-new']));
  });

  it('treats a deleted then recreated id as a new arrival', () => {
    useFreshNodesStore.getState().observeNodeIds('workspace-a', ['a', 'b']);
    useFreshNodesStore.getState().observeNodeIds('workspace-a', ['a']);
    useFreshNodesStore.getState().observeNodeIds('workspace-a', ['a', 'b']);

    expect(
      useFreshNodesStore.getState().freshnessByWorkspace.get('workspace-a')?.freshIds,
    ).toEqual(new Set(['b']));
  });

  it('skips falsy ids defensively', () => {
    useFreshNodesStore.getState().observeNodeIds('workspace-a', ['', 'a']);
    expect(
      useFreshNodesStore.getState().freshnessByWorkspace.get('workspace-a')?.seenIds,
    ).toEqual(new Set(['a']));
  });

  it('reset clears every workspace baseline', () => {
    useFreshNodesStore.getState().observeNodeIds('workspace-a', ['a']);
    useFreshNodesStore.getState().observeNodeIds('workspace-a', ['a', 'b']);
    useFreshNodesStore.getState().observeNodeIds('workspace-b', ['a']);
    useFreshNodesStore.getState().reset();
    expect(useFreshNodesStore.getState().freshnessByWorkspace.size).toBe(0);
  });
});
