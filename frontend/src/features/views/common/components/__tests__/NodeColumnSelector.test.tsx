import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NodeColumnSelector } from '../NodeColumnSelector';

describe('NodeColumnSelector', () => {
  it('renders an empty disabled dropdown when no columns are available', () => {
    render(
      <NodeColumnSelector
        columns={[]}
        label="Text Column"
        noColumnsMessage="No text columns available"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Text Column')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('combobox')).toHaveTextContent('No text columns available');
  });
});
