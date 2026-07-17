import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileTree } from '../FileTree';

describe('FileTree workspace routing', () => {
  it('keeps the responsive Add action disabled when no workspace is selected', () => {
    const onAddFile = vi.fn();
    render(
      <FileTree
        nodes={[{ type: 'file', name: 'records.csv', path: 'records.csv', size: 10 }]}
        selectedFile={null}
        loadingFiles={false}
        hasWorkspaceSelected={false}
        onPreviewFile={vi.fn()}
        onAddFile={onAddFile}
        onSelectFile={vi.fn()}
        onDownloadFile={vi.fn()}
        onDeleteFile={vi.fn()}
        onCreateFolderInside={vi.fn()}
        onOpenCitation={vi.fn()}
        onMoveFile={vi.fn()}
      />,
    );

    const addButton = screen.getByRole('button', { name: 'Add' });
    expect(addButton).toBeDisabled();
    expect(addButton).toHaveAttribute(
      'title',
      'Load a workspace to add this file as a Data Block',
    );
    expect(screen.getByText('Add')).toHaveClass('hidden', '@min-[40rem]/file-row:inline');
    expect(screen.getByTestId('file-row-records.csv').children[1]).toHaveClass(
      '@container/file-row',
      'flex-wrap',
    );
    fireEvent.click(addButton);
    expect(onAddFile).not.toHaveBeenCalled();
  });
});
