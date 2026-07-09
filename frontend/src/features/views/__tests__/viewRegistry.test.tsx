import { describe, expect, it } from 'vitest';

import { ALL_VIEWS } from '../viewIds';
import { VIEW_DEFINITIONS, isTabbedMainView, isWorkspaceRequired } from '../viewRegistry';

describe('view registry', () => {
  it('keeps one ordered source of truth for visible app views', () => {
    expect(VIEW_DEFINITIONS.map((view) => view.id)).toEqual(ALL_VIEWS);
    expect(VIEW_DEFINITIONS.map((view) => view.label)).toEqual([
      'Data Loader',
      'Preprocessing',
      'Frequency',
      'Concordance',
      'Trends',
      'Topic Modeling',
      'Quotation',
      'Annotation',
      'Export',
    ]);
  });

  it('marks only Data Loader as available before a workspace loads', () => {
    expect(isWorkspaceRequired('data-loader')).toBe(false);
    expect(isWorkspaceRequired('filter')).toBe(true);
    expect(isWorkspaceRequired('export')).toBe(true);
  });

  it('marks analysis-style views as owners of their main card frame', () => {
    expect(isTabbedMainView('annotation')).toBe(true);
    expect(isTabbedMainView('quotation')).toBe(true);
    expect(isTabbedMainView('data-loader')).toBe(false);
  });
});
