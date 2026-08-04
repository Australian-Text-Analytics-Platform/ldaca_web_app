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
        workspaceId={null}
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
    expect(addButton).toHaveAttribute('data-guidance', 'add-data-block');
    expect(addButton).toHaveAttribute('title', 'Load a workspace to add this file as a Data Block');
    expect(screen.getByText('Add')).toHaveClass('hidden', '@min-[640px]/file-row:inline');
    expect(screen.getByTestId('file-row-records.csv').children[1]).toHaveClass(
      '@container/file-row',
      'flex-wrap',
    );
    expect(screen.getByRole('button', { name: 'Download records.csv' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete records.csv' })).toBeInTheDocument();
    fireEvent.click(addButton);
    expect(onAddFile).not.toHaveBeenCalled();
  });

  it('exposes enabled Add actions as guidance anchors when a workspace is selected', () => {
    render(
      <FileTree
        nodes={[{ type: 'file', name: 'records.csv', path: 'records.csv', size: 10 }]}
        selectedFile={null}
        loadingFiles={false}
        hasWorkspaceSelected
        workspaceId="workspace-1"
        onPreviewFile={vi.fn()}
        onAddFile={vi.fn()}
        onSelectFile={vi.fn()}
        onDownloadFile={vi.fn()}
        onDeleteFile={vi.fn()}
        onCreateFolderInside={vi.fn()}
        onOpenCitation={vi.fn()}
        onMoveFile={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Add' })).toHaveAttribute(
      'data-guidance',
      'add-data-block',
    );
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
  });

  it('requires confirmation before deleting a file', () => {
    const onDeleteFile = vi.fn();
    render(
      <FileTree
        nodes={[{ type: 'file', name: 'records.csv', path: 'uploads/records.csv', size: 10 }]}
        selectedFile={null}
        loadingFiles={false}
        hasWorkspaceSelected
        workspaceId="workspace-1"
        onPreviewFile={vi.fn()}
        onAddFile={vi.fn()}
        onSelectFile={vi.fn()}
        onDownloadFile={vi.fn()}
        onDeleteFile={onDeleteFile}
        onCreateFolderInside={vi.fn()}
        onOpenCitation={vi.fn()}
        onMoveFile={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete records.csv' }));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delete “records.csv”?' })).toBeInTheDocument();
    expect(onDeleteFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onDeleteFile).not.toHaveBeenCalled();
  });

  it('confirms deletion of a folder and its contents', () => {
    const onDeleteFile = vi.fn();
    render(
      <FileTree
        nodes={[
          {
            type: 'directory',
            name: 'archive',
            path: 'uploads/archive',
            loadable: false,
            children: [
              {
                type: 'file',
                name: 'records.csv',
                path: 'uploads/archive/records.csv',
                size: 10,
                loadable: true,
              },
            ],
          },
        ]}
        selectedFile={null}
        loadingFiles={false}
        hasWorkspaceSelected
        workspaceId="workspace-1"
        onPreviewFile={vi.fn()}
        onAddFile={vi.fn()}
        onSelectFile={vi.fn()}
        onDownloadFile={vi.fn()}
        onDeleteFile={onDeleteFile}
        onCreateFolderInside={vi.fn()}
        onOpenCitation={vi.fn()}
        onMoveFile={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete folder archive' }));

    expect(screen.getByText(/everything inside it/)).toBeInTheDocument();
    expect(onDeleteFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete folder' }));

    expect(onDeleteFile).toHaveBeenCalledOnce();
    expect(onDeleteFile).toHaveBeenCalledWith('uploads/archive');
  });
});
