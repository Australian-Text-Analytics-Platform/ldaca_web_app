import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
});