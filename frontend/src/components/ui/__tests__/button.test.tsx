import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from '../button';

describe('Button', () => {
  it.each([
    'default',
    'secondary',
    'destructive',
    'outline',
    'ghost',
    'link',
  ] as const)('fades the complete disabled %s button like VS Code', (variant) => {
    render(
      <Button variant={variant} disabled>
        Save
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveClass('disabled:opacity-40', 'disabled:cursor-default');
    expect(button.className).not.toContain('disabled:text-');
    expect(button.className).not.toContain('disabled:bg-');
  });

  it('uses VS Code standard and compact button geometry', () => {
    const { rerender } = render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass(
      'h-control',
      'px-[8px]',
      'py-[4px]',
      'text-label',
      'font-normal',
      'leading-4',
    );

    rerender(<Button size="sm">Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass(
      'h-control-sm',
      'px-[6px]',
      'py-[3px]',
      'text-label-secondary',
      'leading-[14px]',
    );
  });
});
