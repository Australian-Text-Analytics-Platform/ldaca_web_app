import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { acceptPlaceholderOnTab } from '../placeholderTabFill';

/** Controlled input harness for the shared placeholder-to-value Tab flow. */
function PlaceholderHarness() {
  const [value, setValue] = useState('');

  return (
    <div>
      <input
        aria-label="Generated name"
        value={value}
        placeholder="Suggested_output_name"
        onChange={(event) => {
          setValue(event.target.value);
        }}
        onKeyDown={(event) => {
          acceptPlaceholderOnTab({ event, value, setValue });
        }}
      />
      <button type="button">Next</button>
    </div>
  );
}

describe('acceptPlaceholderOnTab', () => {
  it('fills the placeholder on the first tab, keeps focus, and yields focus on the second tab', async () => {
    const user = userEvent.setup();

    render(<PlaceholderHarness />);

    const input = screen.getByLabelText<HTMLInputElement>('Generated name');
    const nextButton = screen.getByRole('button', { name: 'Next' });

    input.focus();
    expect(input).toHaveFocus();

    await user.tab();

    expect(input).toHaveValue('Suggested_output_name');
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe('Suggested_output_name'.length);
    expect(input.selectionEnd).toBe('Suggested_output_name'.length);

    await user.tab();

    expect(nextButton).toHaveFocus();
  });
});
