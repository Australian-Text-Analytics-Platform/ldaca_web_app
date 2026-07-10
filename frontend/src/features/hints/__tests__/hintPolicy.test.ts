import { describe, expect, it } from 'vitest';

import { selectEligibleHint } from '../hintPolicy';
import type { HintConditionMap, HintDefinition } from '../types';

const conditions = {
  'no-active-workspace': true,
  'workspace-has-no-nodes': true,
  'file-uploaded-not-added': false,
  'file-uploaded-no-workspace': false,
  'filter-no-node-selected': false,
  'filter-awaiting-column-selection': false,
} satisfies HintConditionMap;

const hints: HintDefinition[] = [
  {
    id: 'first',
    title: 'First',
    body: 'First body',
    condition: 'no-active-workspace',
    anchorHintId: 'first-target',
  },
  {
    id: 'second',
    title: 'Second',
    body: 'Second body',
    condition: 'workspace-has-no-nodes',
    anchorHintId: 'second-target',
  },
];

describe('selectEligibleHint', () => {
  it('uses registry order and skips persistent and session dismissals', () => {
    const firstTarget = document.createElement('button');
    firstTarget.dataset.hintId = 'first-target';
    const secondTarget = document.createElement('button');
    secondTarget.dataset.hintId = 'second-target';
    document.body.append(firstTarget, secondTarget);

    expect(
      selectEligibleHint({
        hints,
        conditions,
        context: { lastUploadedFilePath: null },
        dismissedHints: [],
        sessionDismissedHints: [],
      })?.hint.id,
    ).toBe('first');

    firstTarget.remove();
    expect(
      selectEligibleHint({
        hints,
        conditions,
        context: { lastUploadedFilePath: null },
        dismissedHints: [],
        sessionDismissedHints: [],
      })?.hint.id,
    ).toBe('second');
    document.body.prepend(firstTarget);

    expect(
      selectEligibleHint({
        hints,
        conditions,
        context: { lastUploadedFilePath: null },
        dismissedHints: ['first'],
        sessionDismissedHints: [],
      })?.hint.id,
    ).toBe('second');

    expect(
      selectEligibleHint({
        hints,
        conditions,
        context: { lastUploadedFilePath: null },
        dismissedHints: [],
        sessionDismissedHints: ['first', 'second'],
      }),
    ).toBeNull();
  });
});
