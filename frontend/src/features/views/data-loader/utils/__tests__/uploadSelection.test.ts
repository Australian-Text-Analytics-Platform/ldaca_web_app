import { describe, expect, it } from 'vitest';
import type { FileTreeNode } from '../../types';
import {
  collectDroppedSelection,
  collectPickerSelection,
  computeUploadConflicts,
  getMissingUploadDirectories,
  prepareUploadSelection,
  type DroppedEntry,
} from '../uploadSelection';

function file(name: string, relativePath = '') {
  const value = new File([name], name);
  Object.defineProperty(value, 'webkitRelativePath', { value: relativePath });
  return value;
}

function fileEntry(name: string, value = file(name)): DroppedEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (resolve) => resolve(value),
  };
}

function directoryEntry(name: string, batches: DroppedEntry[][]): DroppedEntry {
  let index = 0;
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (resolve) => resolve(batches[index++] ?? []),
    }),
  };
}

describe('upload selection', () => {
  it('traverses every directory-reader batch and preserves the dropped root', async () => {
    const root = directoryEntry('corpus', [
      [fileEntry('a.csv')],
      [directoryEntry('nested', [[fileEntry('b.csv')], []])],
      [],
    ]);

    const result = await collectDroppedSelection([root]);

    expect(result.candidates.map(({ relativePath }) => relativePath)).toEqual([
      'corpus/a.csv',
      'corpus/nested/b.csv',
    ]);
    expect(result.folderRoots).toEqual(['corpus']);
  });

  it('normalizes mixed loose-file and folder roots and ignores source-empty folders', async () => {
    const result = prepareUploadSelection(
      await collectDroppedSelection([
        fileEntry('loose.csv'),
        directoryEntry('corpus', [[fileEntry('inside.csv')], []]),
        directoryEntry('empty', [[]]),
      ]),
    );

    expect(result.files.map(({ relativePath }) => relativePath)).toEqual([
      'corpus/inside.csv',
      'loose.csv',
    ]);
    expect(result.requiredDirectories).toEqual(['corpus']);
  });

  it('uses picker relative paths and derives parent folders without source-empty folders', () => {
    const result = prepareUploadSelection(
      collectPickerSelection([file('a.csv', 'corpus/a.csv'), file('b.csv', 'corpus/nested/b.csv')]),
    );

    expect(result.files.map(({ relativePath }) => relativePath)).toEqual([
      'corpus/a.csv',
      'corpus/nested/b.csv',
    ]);
    expect(result.requiredDirectories).toEqual(['corpus', 'corpus/nested']);
    expect(result.conflicts).toEqual([]);
  });

  it('short-circuits hidden directories and counts hidden files separately', async () => {
    let hiddenDirectoryRead = false;
    const hiddenDirectory: DroppedEntry = {
      isFile: false,
      isDirectory: true,
      name: '.cache',
      createReader: () => ({
        readEntries: () => {
          hiddenDirectoryRead = true;
        },
      }),
    };
    const root = directoryEntry('corpus', [
      [hiddenDirectory, fileEntry('.secret'), fileEntry('Thumbs.DB'), fileEntry('visible.csv')],
      [],
    ]);

    const result = await collectDroppedSelection([root]);

    expect(hiddenDirectoryRead).toBe(false);
    expect(result.skipped).toEqual({ files: 2, directories: 1 });
    expect(result.candidates.map(({ relativePath }) => relativePath)).toEqual([
      'corpus/visible.csv',
    ]);
  });

  it('surfaces traversal failures instead of silently uploading a partial folder', async () => {
    const broken: DroppedEntry = {
      isFile: false,
      isDirectory: true,
      name: 'broken',
      createReader: () => ({
        readEntries: (_resolve, reject) => reject?.(new DOMException('Access denied')),
      }),
    };

    await expect(collectDroppedSelection([broken])).rejects.toThrow('Access denied');
  });

  it('rejects non-portable paths and internal file-directory collisions', () => {
    const result = prepareUploadSelection({
      candidates: [
        { file: file('bad?.csv'), relativePath: 'bad?.csv' },
        { file: file('data'), relativePath: 'data' },
        { file: file('inside.csv'), relativePath: 'data/inside.csv' },
      ],
      folderRoots: [],
      skipped: { files: 0, directories: 0 },
      unsupportedFolderDrop: false,
    });

    expect(result.conflicts).toEqual(['bad?.csv', 'data']);
  });

  it('rejects duplicate selected folder roots even when their files do not overlap', () => {
    const result = prepareUploadSelection({
      candidates: [
        { file: file('a.csv'), relativePath: 'Corpus/a.csv' },
        { file: file('b.csv'), relativePath: 'corpus/b.csv' },
      ],
      folderRoots: ['Corpus', 'corpus'],
      skipped: { files: 0, directories: 0 },
      unsupportedFolderDrop: false,
    });

    expect(result.conflicts).toEqual(['Corpus', 'corpus']);
  });

  it('reports all existing file conflicts from the complete User File tree', () => {
    const selection = prepareUploadSelection(
      collectPickerSelection([
        file('new.csv', 'corpus/new.csv'),
        file('blocked.csv', 'blocked/inside.csv'),
        file('hidden.bin', 'hidden.bin'),
      ]),
    );
    const completeTree: FileTreeNode[] = [
      {
        name: 'corpus',
        path: 'corpus',
        type: 'directory',
        children: [
          {
            name: 'new.csv',
            path: 'corpus/new.csv',
            type: 'file',
            size: 1,
            loadable: true,
          },
        ],
      },
      {
        name: 'blocked',
        path: 'blocked',
        type: 'file',
        size: 1,
        loadable: false,
      },
      {
        name: 'hidden.bin',
        path: 'hidden.bin',
        type: 'file',
        size: 1,
        loadable: false,
      },
    ];

    expect(computeUploadConflicts(selection, completeTree)).toEqual([
      'blocked',
      'corpus/new.csv',
      'hidden.bin',
    ]);
    expect(getMissingUploadDirectories(selection, completeTree)).toEqual(['blocked']);
  });
});
