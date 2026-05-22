import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AddFilePanel } from '../AddFilePanel';

vi.mock('@/hooks/useFilePreview', () => ({
  useFilePreview: () => ({
    previewData: [{ document: 'hello world' }],
    columns: ['document'],
    loading: false,
    error: null,
    fileType: 'csv',
    sheetNames: null,
    selectedSheet: null,
    setSelectedSheet: vi.fn(),
  }),
}));

describe('AddFilePanel', () => {
  it('uses user-facing data block wording instead of LazyFrame terminology', () => {
    render(
      <AddFilePanel
        filename="documents.csv"
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getAllByText(/Files are added as data blocks automatically/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/LazyFrame/i)).not.toBeInTheDocument();
  });

  it('shows the derived default name as a placeholder on the data block name input', () => {
    render(
      <AddFilePanel
        filename="Hansard/housing_agenda.csv"
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const input = screen.getByLabelText('Data block name') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Hansard/housing_agenda');
  });

  it('sends undefined when the user leaves the name blank, letting the server derive it', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    render(
      <AddFilePanel
        filename="documents.csv"
        open
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    await user.click(screen.getByRole('button', { name: /Add to Workspace/i }));

    expect(onConfirm).toHaveBeenCalledWith(null, undefined);
  });

  it('passes the user-typed name through to onConfirm', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    render(
      <AddFilePanel
        filename="documents.csv"
        open
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    const input = screen.getByLabelText('Data block name');
    await user.type(input, 'my_corpus');
    await user.click(screen.getByRole('button', { name: /Add to Workspace/i }));

    expect(onConfirm).toHaveBeenCalledWith(null, 'my_corpus');
  });

  it('fills the input with the placeholder when Tab is pressed on an empty input', async () => {
    const user = userEvent.setup();

    render(
      <AddFilePanel
        filename="Hansard/housing_agenda.csv"
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const input = screen.getByLabelText('Data block name') as HTMLInputElement;
    input.focus();
    await user.tab();

    expect(input).toHaveValue('Hansard/housing_agenda');
  });
});