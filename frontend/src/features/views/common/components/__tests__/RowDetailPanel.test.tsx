import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RowDetailPanel, type RowDetailNavigation } from '../RowDetailPanel';

const navigation = (overrides: Partial<RowDetailNavigation> = {}): RowDetailNavigation => ({
  canPrevious: true,
  canNext: true,
  pendingDirection: null,
  error: null,
  onPrevious: vi.fn(),
  onNext: vi.fn(),
  ...overrides,
});

describe('RowDetailPanel', () => {
  it('renders persistent accessible row navigation outside the scroll body', async () => {
    const user = userEvent.setup();
    const controls = navigation();
    render(
      <RowDetailPanel
        open
        onOpenChange={vi.fn()}
        payload={{ record: { label: 'First row' } }}
        navigation={controls}
      />,
    );

    const previous = screen.getByRole('button', { name: 'Previous row' });
    const next = screen.getByRole('button', { name: 'Next row' });
    expect(screen.getByTestId('row-detail-scroll')).not.toContainElement(
      screen.getByTestId('row-detail-navigation'),
    );
    await user.click(previous);
    await user.click(next);
    expect(controls.onPrevious).toHaveBeenCalledOnce();
    expect(controls.onNext).toHaveBeenCalledOnce();
  });

  it('shows pending and error states and resets scroll for a new payload', async () => {
    const { rerender } = render(
      <RowDetailPanel
        open
        onOpenChange={vi.fn()}
        payload={{ record: { label: 'First row' } }}
        navigation={navigation({ pendingDirection: 'next' })}
      />,
    );
    const scrollBody = screen.getByTestId('row-detail-scroll');
    scrollBody.scrollTop = 120;
    expect(screen.getByRole('status')).toHaveTextContent('Loading next row');
    expect(screen.getByRole('button', { name: 'Previous row' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next row' })).toBeDisabled();

    rerender(
      <RowDetailPanel
        open
        onOpenChange={vi.fn()}
        payload={{ record: { label: 'Second row' } }}
        navigation={navigation({ error: 'Could not load the next row.' })}
      />,
    );
    await waitFor(() => {
      expect(scrollBody.scrollTop).toBe(0);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the next row.');
  });
});
