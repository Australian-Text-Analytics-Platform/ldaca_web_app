import { beforeEach, describe, expect, it } from 'vitest';
import { useFreshNodesStore } from '../freshNodesStore';

describe('useFreshNodesStore', () => {
  beforeEach(() => {
    useFreshNodesStore.getState().reset();
  });

  it('first observation does NOT mark anything fresh', () => {
    useFreshNodesStore.getState().observeNodeIds(['a', 'b', 'c']);
    const { seenIds, freshIds } = useFreshNodesStore.getState();
    expect(seenIds).toEqual(new Set(['a', 'b', 'c']));
    expect(freshIds).toEqual(new Set());
  });

  it('subsequent observation marks new ids as fresh, leaves existing ones alone', () => {
    useFreshNodesStore.getState().observeNodeIds(['a', 'b']);
    useFreshNodesStore.getState().observeNodeIds(['a', 'b', 'c']);
    expect(useFreshNodesStore.getState().freshIds).toEqual(new Set(['c']));
  });

  it('multiple new arrivals in one observation all get marked fresh', () => {
    useFreshNodesStore.getState().observeNodeIds(['a']);
    useFreshNodesStore.getState().observeNodeIds(['a', 'b', 'c']);
    expect(useFreshNodesStore.getState().freshIds).toEqual(new Set(['b', 'c']));
  });

  it('observation is idempotent for already-seen ids', () => {
    useFreshNodesStore.getState().observeNodeIds(['a', 'b']);
    useFreshNodesStore.getState().observeNodeIds(['a', 'b']);
    expect(useFreshNodesStore.getState().freshIds).toEqual(new Set());
  });

  it('markInteracted clears the given fresh ids', () => {
    useFreshNodesStore.getState().observeNodeIds(['a']);
    useFreshNodesStore.getState().observeNodeIds(['a', 'b', 'c']);
    useFreshNodesStore.getState().markInteracted(['b']);
    expect(useFreshNodesStore.getState().freshIds).toEqual(new Set(['c']));
  });

  it('markInteracted is a no-op for ids not currently fresh', () => {
    useFreshNodesStore.getState().observeNodeIds(['a', 'b']);
    useFreshNodesStore.getState().markInteracted(['a']);
    expect(useFreshNodesStore.getState().freshIds).toEqual(new Set());
    expect(useFreshNodesStore.getState().seenIds).toEqual(new Set(['a', 'b']));
  });

  it('forgetNodeIds removes from both seen and fresh', () => {
    useFreshNodesStore.getState().observeNodeIds(['a']);
    useFreshNodesStore.getState().observeNodeIds(['a', 'b']);
    useFreshNodesStore.getState().forgetNodeIds(['b']);
    expect(useFreshNodesStore.getState().seenIds).toEqual(new Set(['a']));
    expect(useFreshNodesStore.getState().freshIds).toEqual(new Set());
    // After forgetting, b can be re-observed as a fresh arrival.
    useFreshNodesStore.getState().observeNodeIds(['a', 'b']);
    expect(useFreshNodesStore.getState().freshIds).toEqual(new Set(['b']));
  });

  it('skips falsy ids defensively', () => {
    useFreshNodesStore.getState().observeNodeIds(['', 'a']);
    expect(useFreshNodesStore.getState().seenIds).toEqual(new Set(['a']));
  });

  it('reset clears both sets', () => {
    useFreshNodesStore.getState().observeNodeIds(['a']);
    useFreshNodesStore.getState().observeNodeIds(['a', 'b']);
    useFreshNodesStore.getState().reset();
    expect(useFreshNodesStore.getState().seenIds.size).toBe(0);
    expect(useFreshNodesStore.getState().freshIds.size).toBe(0);
  });
});
