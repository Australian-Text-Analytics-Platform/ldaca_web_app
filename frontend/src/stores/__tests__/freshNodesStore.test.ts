import { beforeEach, describe, expect, it } from 'vitest';
import { useFreshNodesStore } from '../freshNodesStore';

describe('useFreshNodesStore', () => {
  beforeEach(() => {
    useFreshNodesStore.getState().reset();
  });

  it('does not mark loaded Workspace nodes as new', () => {
    useFreshNodesStore.getState().reconcileNodeIds('workspace-a', ['a', 'b', 'c']);
    expect(useFreshNodesStore.getState().freshIdsByWorkspace.has('workspace-a')).toBe(false);
  });

  it('marks only explicitly created Data Blocks as new', () => {
    useFreshNodesStore.getState().reconcileNodeIds('workspace-a', ['existing']);
    useFreshNodesStore.getState().markCreated('workspace-a', ['created']);
    useFreshNodesStore.getState().reconcileNodeIds('workspace-a', ['existing', 'created']);

    expect(useFreshNodesStore.getState().freshIdsByWorkspace.get('workspace-a')).toEqual(
      new Set(['created']),
    );
  });

  it('marks multiple backend-confirmed creations idempotently', () => {
    useFreshNodesStore.getState().markCreated('workspace-a', ['a', 'b']);
    useFreshNodesStore.getState().markCreated('workspace-a', ['b', 'c']);
    expect(useFreshNodesStore.getState().freshIdsByWorkspace.get('workspace-a')).toEqual(
      new Set(['a', 'b', 'c']),
    );
  });

  it('clears a marker after interaction', () => {
    useFreshNodesStore.getState().markCreated('workspace-a', ['a', 'b']);
    useFreshNodesStore.getState().markInteracted('workspace-a', ['a']);
    expect(useFreshNodesStore.getState().freshIdsByWorkspace.get('workspace-a')).toEqual(
      new Set(['b']),
    );
  });

  it('removes markers for deleted Data Blocks without marking new graph arrivals', () => {
    useFreshNodesStore.getState().markCreated('workspace-a', ['created', 'deleted']);
    useFreshNodesStore.getState().reconcileNodeIds('workspace-a', ['existing', 'created']);
    expect(useFreshNodesStore.getState().freshIdsByWorkspace.get('workspace-a')).toEqual(
      new Set(['created']),
    );
  });

  it('tracks overlapping IDs independently per Workspace', () => {
    useFreshNodesStore.getState().markCreated('workspace-a', ['shared']);
    useFreshNodesStore.getState().markCreated('workspace-b', ['shared']);
    useFreshNodesStore.getState().markInteracted('workspace-a', ['shared']);

    expect(useFreshNodesStore.getState().freshIdsByWorkspace.has('workspace-a')).toBe(false);
    expect(useFreshNodesStore.getState().freshIdsByWorkspace.get('workspace-b')).toEqual(
      new Set(['shared']),
    );
  });

  it('skips empty workspace and Data Block IDs', () => {
    useFreshNodesStore.getState().markCreated('', ['a']);
    useFreshNodesStore.getState().markCreated('workspace-a', ['', 'a']);
    expect(useFreshNodesStore.getState().freshIdsByWorkspace.get('workspace-a')).toEqual(
      new Set(['a']),
    );
  });

  it('reset clears every Workspace marker', () => {
    useFreshNodesStore.getState().markCreated('workspace-a', ['a']);
    useFreshNodesStore.getState().markCreated('workspace-b', ['b']);
    useFreshNodesStore.getState().reset();
    expect(useFreshNodesStore.getState().freshIdsByWorkspace.size).toBe(0);
  });
});
