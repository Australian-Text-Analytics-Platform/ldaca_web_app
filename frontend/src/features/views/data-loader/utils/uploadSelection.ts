import type { FileTreeNode } from '../types';

interface UploadCandidate {
  file: File;
  relativePath: string;
}

interface HiddenEntrySkips {
  files: number;
  directories: number;
}

export interface UploadSelectionInput {
  candidates: UploadCandidate[];
  folderRoots: string[];
  skipped: HiddenEntrySkips;
  unsupportedFolderDrop: boolean;
}

export interface PreparedUploadSelection extends UploadSelectionInput {
  files: UploadCandidate[];
  requiredDirectories: string[];
  conflicts: string[];
}

interface DroppedDirectoryReader {
  readEntries: (
    success: (entries: DroppedEntry[]) => void,
    failure?: (error: DOMException) => void,
  ) => void;
}

export interface DroppedEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (file: File) => void, failure?: (error: DOMException) => void) => void;
  createReader?: () => DroppedDirectoryReader;
}

const PORTABLE_MAX_COMPONENT_BYTES = 255;
const PORTABLE_MAX_PATH_BYTES = 1024;
const PORTABLE_MAX_DEPTH = 32;
const FORBIDDEN_COMPONENT_CHARACTERS = /[<>:"/\\|?*]/u;
const WINDOWS_RESERVED_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;
const encoder = new TextEncoder();

function comparePaths(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function portableCollisionKey(path: string) {
  return path.normalize('NFC').toUpperCase();
}

function isHiddenName(name: string) {
  return name.startsWith('.') || name.toLowerCase() === 'thumbs.db';
}

function containsControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 31 || codeUnit === 127) return true;
  }
  return false;
}

function isPortableComponent(component: string) {
  if (component.length === 0 || component !== component.normalize('NFC')) return false;
  if (component !== component.trim() || component.endsWith('.') || component.endsWith(' ')) {
    return false;
  }
  if (
    component.includes('..') ||
    FORBIDDEN_COMPONENT_CHARACTERS.test(component) ||
    containsControlCharacter(component) ||
    encoder.encode(component).length > PORTABLE_MAX_COMPONENT_BYTES
  ) {
    return false;
  }
  return !WINDOWS_RESERVED_STEM.test(component.split('.')[0] ?? '');
}

function isPortableRelativePath(path: string) {
  const components = path.split('/');
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    components.length <= PORTABLE_MAX_DEPTH &&
    encoder.encode(path).length <= PORTABLE_MAX_PATH_BYTES &&
    components.every(isPortableComponent)
  );
}

function hiddenComponentIndex(components: string[]) {
  return components.findIndex(isHiddenName);
}

export function collectPickerSelection(files: File[]): UploadSelectionInput {
  const candidates: UploadCandidate[] = [];
  const folderRoots = new Set<string>();
  const skippedDirectories = new Set<string>();
  let skippedFiles = 0;

  for (const file of files) {
    const relativePath = file.webkitRelativePath || file.name;
    const components = relativePath.split('/');
    const hiddenIndex = hiddenComponentIndex(components);
    if (hiddenIndex !== -1) {
      if (hiddenIndex < components.length - 1) {
        skippedDirectories.add(components.slice(0, hiddenIndex + 1).join('/'));
      } else {
        skippedFiles += 1;
      }
      continue;
    }
    if (file.webkitRelativePath && components.length > 1) {
      folderRoots.add(components[0] ?? '');
    }
    candidates.push({ file, relativePath });
  }

  return {
    candidates,
    folderRoots: [...folderRoots],
    skipped: { files: skippedFiles, directories: skippedDirectories.size },
    unsupportedFolderDrop: false,
  };
}

function readFileEntry(entry: DroppedEntry) {
  return new Promise<File>((resolve, reject) => {
    if (!entry.file) {
      reject(new Error(`Unable to read dropped file ${entry.name}.`));
      return;
    }
    entry.file(resolve, reject);
  });
}

async function readAllDirectoryEntries(entry: DroppedEntry) {
  if (!entry.createReader) {
    throw new Error(`Unable to read dropped folder ${entry.name}.`);
  }
  const reader = entry.createReader();
  const entries: DroppedEntry[] = [];
  let batch: DroppedEntry[];
  do {
    batch = await new Promise<DroppedEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    entries.push(...batch);
  } while (batch.length > 0);
  return entries;
}

export async function collectDroppedSelection(
  entries: DroppedEntry[],
): Promise<UploadSelectionInput> {
  const candidates: UploadCandidate[] = [];
  const folderRoots: string[] = [];
  const skipped: HiddenEntrySkips = { files: 0, directories: 0 };

  const visit = async (entry: DroppedEntry, relativePath: string): Promise<void> => {
    if (isHiddenName(entry.name)) {
      if (entry.isDirectory) skipped.directories += 1;
      else skipped.files += 1;
      return;
    }
    if (entry.isFile) {
      candidates.push({ file: await readFileEntry(entry), relativePath });
      return;
    }
    if (!entry.isDirectory) return;
    const children = await readAllDirectoryEntries(entry);
    for (const child of children) {
      await visit(child, `${relativePath}/${child.name}`);
    }
  };

  for (const entry of entries) {
    if (entry.isDirectory && !isHiddenName(entry.name)) folderRoots.push(entry.name);
    await visit(entry, entry.name);
  }

  return { candidates, folderRoots, skipped, unsupportedFolderDrop: false };
}

export function prepareUploadSelection(input: UploadSelectionInput): PreparedUploadSelection {
  const conflicts = new Set<string>();
  const fileKeys = new Map<string, string>();
  const directoryKeys = new Map<string, string>();
  const rootKeys = new Map<string, string>();
  const requiredDirectories = new Set<string>();

  for (const root of input.folderRoots) {
    const key = portableCollisionKey(root);
    const existingRoot = rootKeys.get(key);
    if (existingRoot) {
      conflicts.add(existingRoot);
      conflicts.add(root);
    } else rootKeys.set(key, root);
  }

  for (const candidate of input.candidates) {
    const path = candidate.relativePath;
    if (!isPortableRelativePath(path)) conflicts.add(path);
    const key = portableCollisionKey(path);
    const existingFile = fileKeys.get(key);
    if (existingFile) {
      conflicts.add(existingFile);
      conflicts.add(path);
    } else fileKeys.set(key, path);

    const components = path.split('/');
    for (let index = 1; index < components.length; index += 1) {
      const directory = components.slice(0, index).join('/');
      requiredDirectories.add(directory);
      const directoryKey = portableCollisionKey(directory);
      if (!directoryKeys.has(directoryKey)) directoryKeys.set(directoryKey, directory);
    }
  }

  for (const [key, filePath] of fileKeys) {
    const directoryPath = directoryKeys.get(key);
    if (directoryPath) {
      conflicts.add(filePath);
      conflicts.add(directoryPath);
    }
  }

  return {
    ...input,
    files: [...input.candidates].sort((left, right) =>
      comparePaths(left.relativePath, right.relativePath),
    ),
    requiredDirectories: [...requiredDirectories].sort((left, right) => {
      const depthDifference = left.split('/').length - right.split('/').length;
      return depthDifference || comparePaths(left, right);
    }),
    conflicts: [...conflicts].sort(comparePaths),
  };
}

function flattenTree(nodes: FileTreeNode[], resources = new Map<string, FileTreeNode>()) {
  for (const node of nodes) {
    resources.set(portableCollisionKey(node.path), node);
    if (node.type === 'directory') flattenTree(node.children, resources);
  }
  return resources;
}

export function computeUploadConflicts(
  selection: PreparedUploadSelection,
  completeTree: FileTreeNode[],
) {
  const conflicts = new Set(selection.conflicts);
  const resources = flattenTree(completeTree);
  for (const directory of selection.requiredDirectories) {
    const resource = resources.get(portableCollisionKey(directory));
    if (resource?.type === 'file') conflicts.add(directory);
  }
  for (const candidate of selection.files) {
    if (resources.has(portableCollisionKey(candidate.relativePath))) {
      conflicts.add(candidate.relativePath);
    }
  }
  return [...conflicts].sort(comparePaths);
}

export function getMissingUploadDirectories(
  selection: PreparedUploadSelection,
  completeTree: FileTreeNode[],
) {
  const resources = flattenTree(completeTree);
  return selection.requiredDirectories.filter(
    (path) => resources.get(portableCollisionKey(path))?.type !== 'directory',
  );
}
