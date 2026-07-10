import { describe, expect, it } from 'vitest';

import { visibleViewsFromHidden } from '../useVisibleViews';

describe('visibleViewsFromHidden', () => {
  it('keeps Data Loader reachable when restored preferences incorrectly hide it', () => {
    expect(visibleViewsFromHidden(['data-loader', 'quotation'])).toContain('data-loader');
    expect(visibleViewsFromHidden(['data-loader', 'quotation'])).not.toContain('quotation');
  });
});
