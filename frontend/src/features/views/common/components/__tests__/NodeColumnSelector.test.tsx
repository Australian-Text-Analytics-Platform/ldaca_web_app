import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NodeColumnSelector } from '../NodeColumnSelector';

const WIDE_COLUMNS = ['speaker_id', 'Speaker_Name', 'utterance_text', 'utterance.count', 'notes'];

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

  it('filters the options by substring as the user types', async () => {
    const user = userEvent.setup();
    render(<NodeColumnSelector columns={WIDE_COLUMNS} label="Text Column" onChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));
    expect(screen.getAllByRole('option')).toHaveLength(WIDE_COLUMNS.length);

    await user.type(screen.getByRole('searchbox'), 'speaker');

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'speaker_id',
      'Speaker_Name',
    ]);
  });

  it('filters by anchored wildcard patterns', async () => {
    const user = userEvent.setup();
    render(<NodeColumnSelector columns={WIDE_COLUMNS} label="Text Column" onChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));
    await user.type(screen.getByRole('searchbox'), 'utterance*');

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'utterance_text',
      'utterance.count',
    ]);
  });

  it('reports the match count and an empty state for a query that matches nothing', async () => {
    const user = userEvent.setup();
    render(<NodeColumnSelector columns={WIDE_COLUMNS} label="Text Column" onChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));
    await user.type(screen.getByRole('searchbox'), 'zzz');

    expect(screen.getByText('0 of 5 match')).toBeInTheDocument();
    expect(screen.getByText('No matching columns')).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('commits the highlighted match on Enter', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeColumnSelector columns={WIDE_COLUMNS} label="Text Column" onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));
    await user.type(screen.getByRole('searchbox'), 'utterance_');
    await user.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledWith('utterance_text');
  });

  it('commits a clicked option', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeColumnSelector columns={WIDE_COLUMNS} label="Text Column" onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'notes' }));

    expect(onChange).toHaveBeenCalledWith('notes');
  });

  it('offers the clear row only while the list is unfiltered', async () => {
    const user = userEvent.setup();
    render(
      <NodeColumnSelector
        columns={WIDE_COLUMNS}
        label="Text Column"
        clearOptionValue="__clear__"
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: 'Select column…' })).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox'), 'notes');
    expect(screen.queryByRole('option', { name: 'Select column…' })).not.toBeInTheDocument();
  });

  it('narrows a spreadsheet-scale column list to a selectable handful', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const wideSheet = Array.from({ length: 596 }, (_, index) => `q${String(index)}_response`);
    render(<NodeColumnSelector columns={wideSheet} label="Text Column" onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));
    expect(screen.getAllByRole('option')).toHaveLength(596);

    await user.type(screen.getByRole('searchbox'), 'q59?_response');

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'q590_response',
      'q591_response',
      'q592_response',
      'q593_response',
      'q594_response',
      'q595_response',
    ]);

    await user.click(screen.getByRole('option', { name: 'q593_response' }));
    expect(onChange).toHaveBeenCalledWith('q593_response');
  });

  it('keeps a saved column selectable after it disappears from the block', async () => {
    const user = userEvent.setup();
    render(
      <NodeColumnSelector
        columns={WIDE_COLUMNS}
        value="removed_column"
        preserveValue="removed_column"
        label="Text Column"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox')).toHaveTextContent('removed_column');

    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: 'removed_column' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
