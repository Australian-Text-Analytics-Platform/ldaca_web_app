import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterValueChecklist, type FilterChecklistOption } from '../FilterValueChecklist';

const options: FilterChecklistOption[] = [
  { key: 'a', value: 'alpha', label: 'alpha' },
  { key: 'b', value: 'beta', label: 'beta' },
  { key: 'g', value: 'gamma', label: 'gamma' },
];

describe('FilterValueChecklist', () => {
  it('shows Select All Filtered when query is active and sends only visible options', () => {
    const onSelectAll = vi.fn();

    render(
      <FilterValueChecklist
        idPrefix="cond-1"
        options={options}
        selectedKeys={new Set<string>()}
        disabled={false}
        loading={false}
        error={null}
        searchQuery="a*"
        onSearchQueryChange={vi.fn()}
        onToggleOption={vi.fn()}
        onSelectAll={onSelectAll}
        onClearAll={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: 'Select All Filtered' });
    fireEvent.click(button);

    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(onSelectAll.mock.calls[0]?.[0]).toEqual([{ key: 'a', value: 'alpha', label: 'alpha' }]);
  });

  it('filters visible options using wildcard matching', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    render(
      <FilterValueChecklist
        idPrefix="cond-2"
        options={options}
        selectedKeys={new Set<string>()}
        disabled={false}
        loading={false}
        error={null}
        searchQuery="*mm*"
        onSearchQueryChange={vi.fn()}
        onToggleOption={vi.fn()}
        onSelectAll={vi.fn()}
        onClearAll={vi.fn()}
      />,
      { container },
    );

    const scoped = within(container);

    expect(scoped.queryByText('alpha')).not.toBeInTheDocument();
    expect(scoped.queryByText('beta')).not.toBeInTheDocument();
    expect(scoped.getByText('gamma')).toBeInTheDocument();
  });
});
