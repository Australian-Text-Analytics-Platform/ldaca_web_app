import { describe, expect, it } from 'vitest';

import {
  buildCategoricalOptionEntries,
  getCategoricalOptionKey,
  NULL_OPTION_KEY,
  toCategoricalPrimitive,
} from '../categoricalOptions';

describe('categoricalOptions', () => {
  it('keeps type-aware keys distinct for primitive values', () => {
    expect(getCategoricalOptionKey('1')).toBe('string::1');
    expect(getCategoricalOptionKey(1)).toBe('number::1');
    expect(getCategoricalOptionKey(true)).toBe('boolean::true');
    expect(getCategoricalOptionKey(null)).toBe(NULL_OPTION_KEY);
  });

  it('normalizes non-primitive backend values for checklist comparison', () => {
    const date = new Date('2026-01-02T03:04:05.000Z');

    expect(toCategoricalPrimitive(date)).toBe('2026-01-02T03:04:05.000Z');
    expect(toCategoricalPrimitive({ topic: 3 })).toBe('[object Object]');
  });

  it('deduplicates by type-aware key and prepends null when the backend reports nulls', () => {
    const options = buildCategoricalOptionEntries(['1', 1, '1', null, false], true);

    expect(options.map((option) => option.key)).toEqual([
      NULL_OPTION_KEY,
      'string::1',
      'number::1',
      'boolean::false',
    ]);
    expect(options[0]).toMatchObject({
      value: null,
      label: 'Null (no value)',
      isNull: true,
    });
  });
});
