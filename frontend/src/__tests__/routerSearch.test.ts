import { describe, expect, it } from 'vitest';

import { isViewSearchValue, validateAppSearch, viewSearchFor } from '@/router';

describe('router search helpers', () => {
  it('accepts only known app views', () => {
    expect(isViewSearchValue('concordance')).toBe(true);
    expect(isViewSearchValue('unknown')).toBe(false);
    expect(isViewSearchValue(42)).toBe(false);
  });

  it('validates the view search param without preserving invalid values', () => {
    expect(validateAppSearch({ view: 'topic-modeling' })).toEqual({ view: 'topic-modeling' });
    expect(validateAppSearch({ view: 'settings' })).toEqual({});
    expect(validateAppSearch({})).toEqual({});
  });

  it('omits the default data loader view from generated search state', () => {
    expect(viewSearchFor('data-loader')).toEqual({});
    expect(viewSearchFor('quotation')).toEqual({ view: 'quotation' });
  });
});
