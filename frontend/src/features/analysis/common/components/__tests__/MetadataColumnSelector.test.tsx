import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MetadataColumnSelector } from '../MetadataColumnSelector';

const TestHarness = () => {
  const [showMetadata, setShowMetadata] = useState(false);
  const [selectedColumns, setSelectedColumns] = useState<string[]>(['document']);

  return (
    <MetadataColumnSelector
      showMetadata={showMetadata}
      onShowMetadataChange={setShowMetadata}
      availableColumns={['document', 'speaker']}
      selectedColumns={selectedColumns}
      onSelectedColumnsChange={setSelectedColumns}
    />
  );
};

describe('MetadataColumnSelector', () => {
  it('disables the metadata dropdown until metadata visibility is enabled', () => {
    const { container } = render(<TestHarness />);
    const view = within(container);

    expect(view.getByRole('button', { name: /metadata columns/i })).toBeDisabled();

    fireEvent.click(view.getByRole('checkbox', { name: /show metadata/i }));

    expect(view.getByRole('button', { name: /metadata columns/i })).toBeEnabled();
  });

  it('lets users select all columns or individual metadata columns', () => {
    const { container } = render(<TestHarness />);
    const view = within(container);

    fireEvent.click(view.getByRole('checkbox', { name: /show metadata/i }));
    fireEvent.pointerDown(view.getByRole('button', { name: /metadata columns/i }), { button: 0 });

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /select all/i }));

    expect(screen.getByRole('menuitemcheckbox', { name: /document/i })).toHaveAttribute('data-state', 'checked');
    expect(screen.getByRole('menuitemcheckbox', { name: /speaker/i })).toHaveAttribute('data-state', 'checked');

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /speaker/i }));

    expect(screen.getByRole('menuitemcheckbox', { name: /document/i })).toHaveAttribute('data-state', 'checked');
    expect(screen.getByRole('menuitemcheckbox', { name: /speaker/i })).toHaveAttribute('data-state', 'unchecked');
  });
});