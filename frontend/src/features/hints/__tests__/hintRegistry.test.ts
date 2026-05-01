import { describe, it, expect } from 'vitest';
import { hintRegistry } from '../hintRegistry';
import type { HintConditionId, HintDefinition } from '../types';

/**
 * Sanity tests for the hint registry. The registry is otherwise dead code
 * until conditions wire it up at runtime; these checks catch the most common
 * misconfiguration regressions (duplicate ids, missing anchors, unknown
 * condition ids).
 */
describe('hintRegistry', () => {
  it('has unique hint ids', () => {
    const ids = hintRegistry.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry references a known condition id', () => {
    const known: HintConditionId[] = [
      'no-active-workspace',
      'workspace-has-no-nodes',
      'file-uploaded-not-added',
      'file-uploaded-no-workspace',
      'filter-no-node-selected',
      'filter-awaiting-column-selection',
    ];
    for (const hint of hintRegistry) {
      expect(known).toContain(hint.condition);
    }
  });

  it('resolves the filter column hint only when the column selector is still empty', () => {
    const hint = hintRegistry.find((entry) => entry.id === 'preprocessing.filter.select-column');

    expect(hint?.resolveAnchor).toBeTypeOf('function');

    const emptyTrigger = document.createElement('button');
    emptyTrigger.setAttribute('data-hint-id', 'preprocessing.filter.condition-column');
    emptyTrigger.setAttribute('data-filter-column-empty', 'true');
    document.body.appendChild(emptyTrigger);

    const filledTrigger = document.createElement('button');
    filledTrigger.setAttribute('data-hint-id', 'preprocessing.filter.condition-column');
    filledTrigger.setAttribute('data-filter-column-empty', 'false');
    document.body.appendChild(filledTrigger);

    expect(hint?.resolveAnchor?.({ lastUploadedFilePath: null })).toBe(emptyTrigger);

    emptyTrigger.remove();
    filledTrigger.remove();
  });

  it('every entry has either an anchorHintId or a resolveAnchor', () => {
    for (const hint of hintRegistry as HintDefinition[]) {
      const ok = !!hint.anchorHintId || typeof hint.resolveAnchor === 'function';
      expect(ok, `Hint "${hint.id}" needs anchorHintId or resolveAnchor`).toBe(true);
    }
  });
});
