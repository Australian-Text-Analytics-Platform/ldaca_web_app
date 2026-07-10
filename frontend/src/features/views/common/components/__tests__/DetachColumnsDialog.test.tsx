import type { ComponentProps, Dispatch, SetStateAction } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DetachColumnsDialog } from '../DetachColumnsDialog';

const nodeOption = {
  node_id: 'node-1',
  node_name: 'Corpus A',
  available_columns: ['text', 'generated', 'speaker'],
  disabled_columns: ['generated'],
  text_column: 'text',
};
const nodeOptions = [nodeOption];

const renderDialog = (
  overrides: Partial<ComponentProps<typeof DetachColumnsDialog>> = {},
) => {
  const props: ComponentProps<typeof DetachColumnsDialog> = {
    open: true,
    onOpenChange: vi.fn() as Dispatch<SetStateAction<boolean>>,
    isDetaching: false,
    title: 'Detach results',
    description: 'Choose columns.',
    detachNodeOptions: nodeOptions,
    selectedDetachColumns: { 'node-1': ['text', 'generated', 'speaker'] },
    toggleDetachColumn: vi.fn(),
    selectAllDetachColumns: vi.fn(),
    deselectAllDetachColumns: vi.fn(),
    handleDetachConfirm: vi.fn(),
    ...overrides,
  };
  render(<DetachColumnsDialog {...props} />);
  return props;
};

describe('DetachColumnsDialog', () => {
  it('renders every available column as an enabled toggle and forwards changes', async () => {
    const user = userEvent.setup();
    const toggleDetachColumn = vi.fn();
    renderDialog({ toggleDetachColumn });

    for (const column of nodeOption.available_columns) {
      expect(screen.getByRole('checkbox', { name: column })).toBeEnabled();
      expect(screen.getByRole('checkbox', { name: column })).toBeChecked();
    }

    await user.click(screen.getByRole('checkbox', { name: 'generated' }));
    expect(toggleDetachColumn).toHaveBeenCalledWith('node-1', 'generated', false);
  });

  it('disables confirmation when a displayed node has no selected columns', () => {
    renderDialog({ selectedDetachColumns: { 'node-1': [] } });

    expect(screen.getByRole('button', { name: 'Add to Workspace' })).toBeDisabled();
  });

  it('forwards Select all when columns remain unselected', async () => {
    const user = userEvent.setup();
    const selectAllDetachColumns = vi.fn();
    renderDialog({
      selectedDetachColumns: { 'node-1': ['text'] },
      selectAllDetachColumns,
    });

    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(selectAllDetachColumns).toHaveBeenCalledOnce();
  });

  it('forwards Deselect all when columns are selected', async () => {
    const user = userEvent.setup();
    const deselectAllDetachColumns = vi.fn();
    renderDialog({ deselectAllDetachColumns });

    await user.click(screen.getByRole('button', { name: 'Deselect all' }));
    expect(deselectAllDetachColumns).toHaveBeenCalledOnce();
  });
});
