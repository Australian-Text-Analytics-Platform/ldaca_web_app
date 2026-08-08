import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useUploadState } from '../useUploadState';

function pickerFile(name: string, relativePath = '') {
  const value = new File([name], name);
  Object.defineProperty(value, 'webkitRelativePath', { value: relativePath });
  return value;
}

function setup(refreshValues: unknown[] = [[]]) {
  const createUploadDirectory = vi.fn().mockResolvedValue(undefined);
  const uploadFileAtPath = vi.fn().mockResolvedValue(undefined);
  const getUploadResource = vi.fn();
  const refreshFiles = vi.fn();
  for (const value of refreshValues) refreshFiles.mockResolvedValueOnce(value);
  const notify = vi.fn();
  const view = renderHook(() =>
    useUploadState({
      createUploadDirectory,
      getUploadResource,
      notify,
      refreshFiles,
      uploadFileAtPath,
    }),
  );
  return {
    ...view,
    createUploadDirectory,
    getUploadResource,
    notify,
    refreshFiles,
    uploadFileAtPath,
  };
}

describe('useUploadState', () => {
  it('preflights file-only uploads against the complete tree and mutates nothing on conflict', async () => {
    const existing = [
      {
        name: 'a.csv',
        path: 'a.csv',
        type: 'file',
        size: 1,
        loadable: false,
      },
      {
        name: 'b.csv',
        path: 'b.csv',
        type: 'file',
        size: 1,
        loadable: true,
      },
    ];
    const state = setup([existing]);

    await act(async () => {
      await state.result.current.uploadSelectedFiles([pickerFile('a.csv'), pickerFile('b.csv')]);
    });

    expect(state.result.current.conflicts).toEqual(['a.csv', 'b.csv']);
    expect(state.createUploadDirectory).not.toHaveBeenCalled();
    expect(state.uploadFileAtPath).not.toHaveBeenCalled();
    expect(state.refreshFiles).toHaveBeenCalledTimes(1);
  });

  it('creates folders parent-first, uploads files by path, and refreshes once after mutation', async () => {
    const state = setup([[], []]);

    await act(async () => {
      await state.result.current.uploadSelectedFiles([
        pickerFile('z.csv', 'corpus/nested/z.csv'),
        pickerFile('a.csv', 'corpus/a.csv'),
      ]);
    });

    expect(state.createUploadDirectory.mock.calls.map(([path]) => path)).toEqual([
      'corpus',
      'corpus/nested',
    ]);
    expect(state.uploadFileAtPath.mock.calls.map(([, path]) => path)).toEqual([
      'corpus/a.csv',
      'corpus/nested/z.csv',
    ]);
    expect(state.refreshFiles).toHaveBeenCalledTimes(2);
    expect(state.notify).toHaveBeenCalledWith('success', 'Uploaded 2 files. Created 2 folders.');
  });

  it('finishes the current request and stops before the next one when cancelled', async () => {
    let finishFirstUpload!: () => void;
    const firstUpload = new Promise<void>((resolve) => {
      finishFirstUpload = resolve;
    });
    const state = setup([[], []]);
    state.uploadFileAtPath.mockImplementationOnce(() => firstUpload);

    let uploadPromise!: Promise<void>;
    act(() => {
      uploadPromise = state.result.current.uploadSelectedFiles([
        pickerFile('a.csv'),
        pickerFile('b.csv'),
      ]);
    });
    await waitFor(() => expect(state.uploadFileAtPath).toHaveBeenCalledTimes(1));

    act(() => state.result.current.cancelUpload());
    await act(async () => {
      finishFirstUpload();
      await uploadPromise;
    });

    expect(state.uploadFileAtPath).toHaveBeenCalledTimes(1);
    expect(state.refreshFiles).toHaveBeenCalledTimes(2);
    expect(state.notify).toHaveBeenCalledWith('info', 'Upload cancelled after 1 of 2 files.');
  });

  it('stops on the first runtime failure and reports its path and partial count', async () => {
    const state = setup([[], []]);
    state.uploadFileAtPath
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk full'));

    await act(async () => {
      await state.result.current.uploadSelectedFiles([
        pickerFile('a.csv'),
        pickerFile('b.csv'),
        pickerFile('c.csv'),
      ]);
    });

    expect(state.uploadFileAtPath).toHaveBeenCalledTimes(2);
    expect(state.notify).toHaveBeenCalledWith(
      'error',
      'Upload failed at b.csv after 1 of 3 files: disk full',
    );
    expect(state.refreshFiles).toHaveBeenCalledTimes(2);
  });

  it('reuses a late create conflict only after verifying the destination is a directory', async () => {
    const state = setup([[], []]);
    state.createUploadDirectory.mockRejectedValueOnce({
      code: 'resource_conflict',
      message: 'already exists',
    });
    state.getUploadResource.mockResolvedValueOnce({
      name: 'corpus',
      path: 'corpus',
      type: 'directory',
      loadable: false,
      modified_at: 1,
    });

    await act(async () => {
      await state.result.current.uploadSelectedFiles([pickerFile('a.csv', 'corpus/a.csv')]);
    });

    expect(state.getUploadResource).toHaveBeenCalledWith('corpus');
    expect(state.uploadFileAtPath).toHaveBeenCalledWith(expect.any(File), 'corpus/a.csv');
    expect(state.refreshFiles).toHaveBeenCalledTimes(2);
  });

  it('stops when a late create conflict resolves to a file', async () => {
    const state = setup([[], []]);
    state.createUploadDirectory.mockRejectedValueOnce({
      code: 'resource_conflict',
      message: 'already exists',
    });
    state.getUploadResource.mockResolvedValueOnce({
      name: 'corpus',
      path: 'corpus',
      type: 'file',
      loadable: false,
      modified_at: 1,
    });

    await act(async () => {
      await state.result.current.uploadSelectedFiles([pickerFile('a.csv', 'corpus/a.csv')]);
    });

    expect(state.uploadFileAtPath).not.toHaveBeenCalled();
    expect(state.notify).toHaveBeenCalledWith(
      'error',
      'Upload failed at corpus after 0 of 1 files: already exists',
    );
    expect(state.refreshFiles).toHaveBeenCalledTimes(2);
  });
});
