import { describe, expect, it } from 'vitest';

import { isTabbedMainView } from '../tabbedMainViews';

describe('WorkspaceShell tabbed main view classification', () => {
  it('strips the shared middle-column card for Annotation like other tabbed views', () => {
    expect(isTabbedMainView('annotation')).toBe(true);
    expect(isTabbedMainView('quotation')).toBe(true);
    expect(isTabbedMainView('data-loader')).toBe(false);
  });
});
