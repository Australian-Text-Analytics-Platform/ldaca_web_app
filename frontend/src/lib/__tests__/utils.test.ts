import { describe, expect, it } from 'vitest';

import { cn } from '../utils';

describe('cn', () => {
  it.each([
    'text-heading-1',
    'text-heading-2',
    'text-heading-3',
    'text-body',
    'text-body-secondary',
    'text-label',
    'text-label-secondary',
    'text-badge',
  ])('keeps the %s font size alongside a semantic text color', (fontSize) => {
    expect(cn(fontSize, 'text-button-foreground')).toBe(`${fontSize} text-button-foreground`);
  });

  it('still resolves competing semantic font sizes', () => {
    expect(cn('text-label', 'text-label-secondary')).toBe('text-label-secondary');
  });

  it('still resolves competing semantic text colors', () => {
    expect(cn('text-foreground', 'text-button-foreground')).toBe('text-button-foreground');
  });
});
