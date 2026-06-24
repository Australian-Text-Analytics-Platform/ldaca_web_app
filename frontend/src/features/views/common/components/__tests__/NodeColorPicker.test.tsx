import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NodeColorPicker } from '../NodeColorPicker';

describe('NodeColorPicker', () => {
  it('shows preset colours first and reveals custom controls on demand', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <NodeColorPicker
        nodeName="Corpus A"
        color="#2563eb"
        presets={['#2563eb', '#dc2626']}
        onChange={onChange}
      />,
    );

    expect(screen.queryByLabelText(/hex color for corpus a/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /change color for corpus a/i }));

    expect(screen.getAllByText(/^Color$/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Corpus A')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /use #dc2626 for corpus a/i }));

    expect(onChange).toHaveBeenCalledWith('#dc2626');
    expect(screen.queryByLabelText(/hex color for corpus a/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^custom$/i }));

    expect(screen.getByLabelText(/custom color for corpus a/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/hex color for corpus a/i)).toBeInTheDocument();
  });
});
