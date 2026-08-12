import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MetadataColumnSelector } from '../MetadataColumnSelector';

const TestHarness = ({
  disabledReason,
  disabledColumns,
}: {
  disabledReason?: string;
  disabledColumns?: string[];
}) => {
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);

  return (
    <MetadataColumnSelector
      availableColumns={['document', 'speaker']}
      selectedColumns={selectedColumns}
      onSelectedColumnsChange={setSelectedColumns}
      disabledReason={disabledReason}
      disabledColumns={disabledColumns}
    />
  );
};

describe('MetadataColumnSelector', () => {
  it('keeps the dropdown enabled by default and starts with no columns selected', () => {
    const { container } = render(<TestHarness />);
    const view = within(container);

    const trigger = view.getByRole('button', { name: /show metadata/i });
    expect(trigger).toBeEnabled();
    expect(trigger).toHaveTextContent(/show metadata \(0\)/i);
  });

  it('disables the dropdown when a disabledReason is supplied', () => {
    const { container } = render(<TestHarness disabledReason="No shared columns" />);
    const view = within(container);

    expect(view.getByRole('button', { name: /show metadata/i })).toBeDisabled();
  });

  it('lets users select all columns or individual metadata columns', () => {
    const { container } = render(<TestHarness />);
    const view = within(container);

    fireEvent.pointerDown(view.getByRole('button', { name: /show metadata/i }), { button: 0 });

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /select all/i }));

    expect(screen.getByRole('menuitemcheckbox', { name: /document/i })).toHaveAttribute(
      'data-state',
      'checked',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: /speaker/i })).toHaveAttribute(
      'data-state',
      'checked',
    );

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /speaker/i }));

    expect(screen.getByRole('menuitemcheckbox', { name: /document/i })).toHaveAttribute(
      'data-state',
      'checked',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: /speaker/i })).toHaveAttribute(
      'data-state',
      'unchecked',
    );
  });

  it('disables opposite-role columns and skips them when selecting all', () => {
    const { container } = render(<TestHarness disabledColumns={['speaker']} />);
    const view = within(container);

    fireEvent.pointerDown(view.getByRole('button', { name: /show metadata/i }), { button: 0 });
    expect(screen.getByRole('menuitemcheckbox', { name: /speaker/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /select all/i }));
    expect(screen.getByRole('menuitemcheckbox', { name: /document/i })).toHaveAttribute(
      'data-state',
      'checked',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: /speaker/i })).toHaveAttribute(
      'data-state',
      'unchecked',
    );
  });
});
