import { describe, expect, it } from 'vitest';

import {
  concordanceDetachDialogReducer,
  createConcordanceDetachDialogState,
} from '../concordanceDetachDialogState';

const target = { nodeId: 'node-1', column: 'text', nodeLabel: 'Node 1' };
const option = {
  node_id: 'node-1',
  node_name: 'Node 1',
  available_columns: ['text'],
  disabled_columns: [],
  text_column: 'text',
};

describe('concordanceDetachDialogReducer', () => {
  it('opens and resets the per-hit payload atomically', () => {
    const requested = concordanceDetachDialogReducer(createConcordanceDetachDialogState(), {
      type: 'perHitRequested',
      nodes: [target],
    });
    const opened = concordanceDetachDialogReducer(requested, {
      type: 'perHitOpened',
      options: [option],
    });

    expect(opened.perHit).toMatchObject({
      open: true,
      pendingNodes: [target],
      options: [option],
    });

    const reset = concordanceDetachDialogReducer(opened, { type: 'perHitReset' });

    expect(reset.perHit).toMatchObject({
      open: false,
      pendingNodes: [],
      options: [],
    });
  });

  it('keeps dispersion filters with the pending dispersion payload', () => {
    const requested = concordanceDetachDialogReducer(createConcordanceDetachDialogState(), {
      type: 'dispersionRequested',
      nodes: [target],
      selectedBins: [2, 1],
      binCount: 10,
      matchedTexts: ['alpha'],
      caseInsensitive: true,
    });
    const opened = concordanceDetachDialogReducer(requested, {
      type: 'dispersionOpened',
      options: [option],
    });

    expect(opened.dispersion).toMatchObject({
      open: true,
      pendingNodes: [target],
      options: [option],
      selectedBins: [2, 1],
      binCount: 10,
      matchedTexts: ['alpha'],
      caseInsensitive: true,
    });

    const reset = concordanceDetachDialogReducer(opened, { type: 'dispersionReset' });

    expect(reset.dispersion).toMatchObject({
      open: false,
      pendingNodes: [],
      options: [],
      selectedBins: null,
      binCount: 0,
      matchedTexts: null,
      caseInsensitive: false,
    });
  });
});
