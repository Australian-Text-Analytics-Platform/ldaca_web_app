import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useConcordanceDetachDialogs } from '../useConcordanceDetachDialogs';

const nodes = [{ nodeId: 'node-1', column: 'text', nodeLabel: 'Corpus' }];

describe('useConcordanceDetachDialogs', () => {
  it('builds local column choices and sends a typed child-analysis selection', async () => {
    const handleDetach = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useConcordanceDetachDialogs({
        workspaceId: 'workspace-1',
        handleDetach,
        handleDispersionDetach: vi.fn(async () => undefined),
        nodeDetaching: {},
      }),
    );

    await act(async () => result.current.openDetachDialog(nodes));
    expect(result.current.detachDialog.open).toBe(true);
    expect(result.current.detachDialog.detachNodeOptions[0]?.node_id).toBe('node-1');

    await act(async () => result.current.detachDialog.handleDetachConfirm());
    expect(handleDetach).toHaveBeenCalledWith(
      'node-1',
      'text',
      'Corpus',
      expect.arrayContaining(['CONC_matched_text']),
    );
    expect(result.current.detachDialog.open).toBe(false);
  });

  it('starts dispersion selections empty and forwards visible filters', async () => {
    const handleDispersionDetach = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useConcordanceDetachDialogs({
        workspaceId: 'workspace-1',
        handleDetach: vi.fn(async () => undefined),
        handleDispersionDetach,
        nodeDetaching: {},
      }),
    );

    await act(async () =>
      result.current.openDispersionDetachDialog(nodes, new Set([1]), 10, {
        selectedMatchedTexts: ['alpha'],
        matchCaseInsensitive: true,
      }),
    );
    expect(result.current.dispersionDetachDialog.selectedDetachColumns).toEqual({ 'node-1': [] });
    await act(async () => result.current.dispersionDetachDialog.handleDetachConfirm());
    expect(handleDispersionDetach).toHaveBeenCalledWith('node-1', 'text', {
      nodeLabel: 'Corpus',
      selectedBins: new Set([1]),
      binCount: 10,
      selectedColumns: [],
      selectedMatchedTexts: ['alpha'],
      matchCaseInsensitive: true,
    });
  });
});
