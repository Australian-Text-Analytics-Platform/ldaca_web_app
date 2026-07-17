import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileTree } from '../FileTree';

describe('FileTree workspace routing', () => {
  it('keeps Add visibly labelled while disabling it when no workspace is selected', () => {
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
    expect(screen.getByText('Add')).not.toHaveClass('hidden');
    fireEvent.click(addButton);
    expect(onAddFile).not.toHaveBeenCalled();
  });
});
