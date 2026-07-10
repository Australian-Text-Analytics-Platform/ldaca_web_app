#!/usr/bin/env node
/**
 * Verifies the complete bundled documentation contract.
 *
 * Used by: the docs-drift workflow and local frontend verification. Tests
 * import the pure collectors below so missing files, anchors, relative links,
 * and workflow wiring fail before the executable check reaches CI.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BUNDLED_REGISTRY, TUTORIAL_INDEX_TARGET } from '../src/tutorials/bundledRegistry.ts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(SCRIPT_DIR, '..');
const REPO_DIR = resolve(FRONTEND_DIR, '..');
const SRC_DIR = resolve(FRONTEND_DIR, 'src');
const PUBLIC_DIR = resolve(FRONTEND_DIR, 'public');
const WORKFLOW_FILE = resolve(REPO_DIR, '.github/workflows/check-docs-drift.yml');

const COMPONENT_TO_KIND = {
  HelpIcon: 'tutorial',
  InfoIcon: 'info',
  ReferenceIcon: 'reference',
};

const LITERAL_RE = new RegExp(
  `<(${Object.keys(COMPONENT_TO_KIND).join('|')})\\s+[^>]*targetKey=["']([^"']+)["']`,
  'g',
);

const MARKDOWN_LINK_RE = /(!?)\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
const HTML_ANCHOR_RE = /<a\b[^>]*?\bhref=["']([^"']+)["']/gi;
const HTML_IMAGE_RE = /<img\b[^>]*?\bsrc=["']([^"']+)["']/gi;
const EXTERNAL_LINK_RE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

/** Recursively lists files in stable lexical order. */
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(path)));
    else paths.push(path);
  }
  return paths;
}

/** Extracts only anchors that the current ReactMarkdown pipeline renders. */
function collectAnchors(markdown) {
  const anchors = new Set();
  for (const match of markdown.matchAll(/\b(?:id|name)=["']([^"']+)["']/gi)) {
    anchors.add(match[1]);
  }
  return anchors;
}

/** Returns document anchors and images without erasing their runtime semantics. */
function collectLinks(markdown) {
  return [
    ...[...markdown.matchAll(MARKDOWN_LINK_RE)].map((match) => ({
      kind: match[1] ? 'image' : 'anchor',
      rawTarget: match[2],
    })),
    ...[...markdown.matchAll(HTML_ANCHOR_RE)].map((match) => ({
      kind: 'anchor',
      rawTarget: match[1],
    })),
    ...[...markdown.matchAll(HTML_IMAGE_RE)].map((match) => ({
      kind: 'image',
      rawTarget: match[1],
    })),
  ];
}

function normalizeRelativeTarget(sourcePath, { kind, rawTarget }) {
  const target = rawTarget.replace(/^<|>$/g, '');
  if (!target || EXTERNAL_LINK_RE.test(target)) return null;

  const hashIndex = target.indexOf('#');
  const rawPath = (hashIndex >= 0 ? target.slice(0, hashIndex) : target).trim();
  const rawAnchor = (hashIndex >= 0 ? target.slice(hashIndex + 1) : '').trim();
  const runtimePath = rawPath
    ? rawPath.startsWith('/')
      ? posix.normalize(rawPath.replace(/^\/+/, ''))
      : posix.normalize(posix.join(posix.dirname(sourcePath), rawPath))
    : sourcePath;
  const resolvedKind = kind !== 'image' && runtimePath.endsWith('.md') ? 'document' : 'asset';
  const pathWithoutQuery = rawPath.split('?')[0];
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathWithoutQuery);
  } catch {
    return { invalid: true, rawTarget };
  }

  // DocumentView intercepts only Markdown documents (plus hash-only links).
  // Images and non-Markdown hrefs pass through to the browser and follow the
  // public-root asset convention used by the bundled documentation.
  const targetPath = decodedPath
    ? resolvedKind === 'asset' || decodedPath.startsWith('/')
      ? posix.normalize(decodedPath.replace(/^\/+/, ''))
      : posix.normalize(posix.join(posix.dirname(sourcePath), decodedPath))
    : sourcePath;
  return { kind: resolvedKind, targetPath, anchor: rawAnchor };
}

/**
 * Validates registered targets and every relative link in the supplied public
 * documentation map. `availablePaths` may include binary assets that are not
 * present in `documents`.
 */
export function collectDocumentationProblems({
  registry,
  documents,
  availablePaths = new Set(documents.keys()),
  extraTargets = [],
}) {
  const problems = [];
  const anchorsByPath = new Map(
    [...documents].map(([path, markdown]) => [path, collectAnchors(markdown)]),
  );

  const registeredTargets = [];
  for (const [kind, section] of Object.entries(registry)) {
    if (kind === 'meta') continue;
    for (const [key, target] of Object.entries(section)) {
      registeredTargets.push({ name: `${kind}:${key}`, target });
    }
  }
  registeredTargets.push(...extraTargets);

  for (const { name, target } of registeredTargets) {
    if (!availablePaths.has(target.file)) {
      problems.push(`${name} points to missing file ${target.file}`);
      continue;
    }
    if (target.anchor && !anchorsByPath.get(target.file)?.has(target.anchor)) {
      problems.push(`${name} points to missing anchor #${target.anchor} in ${target.file}`);
    }
  }

  const linkedDocuments = new Map();
  for (const [sourcePath, markdown] of [...documents].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const outgoingDocuments = new Set();
    const reportedMissingPaths = new Set();
    const reportedMissingAnchors = new Set();
    for (const link of collectLinks(markdown)) {
      const resolved = normalizeRelativeTarget(sourcePath, link);
      if (!resolved) continue;
      if ('invalid' in resolved) {
        problems.push(`${sourcePath} contains an invalid relative link ${link.rawTarget}`);
        continue;
      }
      if (!availablePaths.has(resolved.targetPath)) {
        if (!reportedMissingPaths.has(resolved.targetPath)) {
          problems.push(`${sourcePath} links to missing relative file ${resolved.targetPath}`);
          reportedMissingPaths.add(resolved.targetPath);
        }
        continue;
      }
      if (resolved.kind === 'document' && documents.has(resolved.targetPath)) {
        outgoingDocuments.add(resolved.targetPath);
      }
      if (
        resolved.kind === 'document' &&
        resolved.anchor &&
        documents.has(resolved.targetPath) &&
        !anchorsByPath.get(resolved.targetPath)?.has(resolved.anchor) &&
        !reportedMissingAnchors.has(`${resolved.targetPath}#${resolved.anchor}`)
      ) {
        problems.push(
          `${sourcePath} links to missing anchor #${resolved.anchor} in ${resolved.targetPath}`,
        );
        reportedMissingAnchors.add(`${resolved.targetPath}#${resolved.anchor}`);
      }
    }
    linkedDocuments.set(sourcePath, outgoingDocuments);
  }

  const reachableDocuments = new Set(
    registeredTargets.map(({ target }) => target.file).filter((path) => documents.has(path)),
  );
  const pendingDocuments = [...reachableDocuments];
  while (pendingDocuments.length > 0) {
    const sourcePath = pendingDocuments.pop();
    for (const targetPath of linkedDocuments.get(sourcePath) ?? []) {
      if (reachableDocuments.has(targetPath)) continue;
      reachableDocuments.add(targetPath);
      pendingDocuments.push(targetPath);
    }
  }
  for (const path of [...documents.keys()].sort()) {
    if (!reachableDocuments.has(path)) {
      problems.push(`${path} is not registered or reachable from registered documentation`);
    }
  }

  return problems;
}

/** Verifies that relevant docs changes actually trigger and execute the workflow. */
export function collectWorkflowProblems(workflow) {
  const problems = [];
  if (!workflow.includes('frontend/public/**')) {
    problems.push('workflow does not trigger for frontend/public documentation');
  }
  if (!workflow.includes('frontend/src/tutorials/bundledRegistry.ts')) {
    problems.push('workflow does not trigger for the bundled registry');
  }
  if (!workflow.includes('frontend/scripts/check-docs-drift.test.mjs')) {
    problems.push('workflow does not trigger for the drift validator tests');
  }
  if (!/run:\s*node\b[^\n]*scripts\/check-docs-drift\.mjs/.test(workflow)) {
    problems.push('workflow does not execute scripts/check-docs-drift.mjs');
  }
  return problems;
}

async function collectSourceLiterals() {
  const files = (await walk(SRC_DIR)).filter(
    (path) => /\.(ts|tsx)$/.test(path) && !path.endsWith('.d.ts') && !path.includes('/__tests__/'),
  );
  const literals = [];
  const sourceByPath = new Map();
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    sourceByPath.set(file, text);
    for (const match of text.matchAll(LITERAL_RE)) {
      literals.push({ file, component: match[1], key: match[2] });
    }
  }
  return { literals, sourceByPath };
}

async function readPublicDocumentation() {
  const files = await walk(PUBLIC_DIR);
  const availablePaths = new Set(
    files.map((path) => relative(PUBLIC_DIR, path).split('\\').join('/')),
  );
  const documents = new Map();
  for (const file of files.filter((path) => extname(path).toLowerCase() === '.md')) {
    documents.set(relative(PUBLIC_DIR, file).split('\\').join('/'), await readFile(file, 'utf8'));
  }
  return { documents, availablePaths };
}

/** Runs all source, bundled content, and workflow checks with deterministic output. */
async function run() {
  const { literals, sourceByPath } = await collectSourceLiterals();
  const missingLiterals = literals.filter(({ component, key }) => {
    const kind = COMPONENT_TO_KIND[component];
    return !BUNDLED_REGISTRY[kind][key];
  });
  const { documents, availablePaths } = await readPublicDocumentation();
  const problems = collectDocumentationProblems({
    registry: BUNDLED_REGISTRY,
    documents,
    availablePaths,
    extraTargets: [{ name: 'tutorial:index', target: TUTORIAL_INDEX_TARGET }],
  });
  problems.push(...collectWorkflowProblems(await readFile(WORKFLOW_FILE, 'utf8')));

  if (missingLiterals.length) {
    problems.unshift(
      ...missingLiterals.map(
        ({ file, component, key }) =>
          `${relative(FRONTEND_DIR, file)}: ${component} targetKey="${key}" has no bundled entry`,
      ),
    );
  }

  if (problems.length) {
    console.error('Documentation drift check failed:\n');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
    return;
  }

  const seenLiteralKeys = new Set(
    literals.map(({ component, key }) => `${COMPONENT_TO_KIND[component]}:${key}`),
  );
  const zeroLiteralEntries = [];
  let dynamicEntries = 0;
  let offlineOnlyEntries = 0;
  for (const [kind, section] of Object.entries(BUNDLED_REGISTRY)) {
    for (const key of Object.keys(section)) {
      if (seenLiteralKeys.has(`${kind}:${key}`)) continue;
      zeroLiteralEntries.push(`${kind}:${key}`);
      const usedDynamically = [...sourceByPath].some(
        ([path, source]) => !path.endsWith('bundledRegistry.ts') && source.includes(key),
      );
      if (usedDynamically) dynamicEntries += 1;
      else offlineOnlyEntries += 1;
    }
  }

  console.log(
    `Docs drift OK — ${literals.length} icon literals, ${documents.size} documents, ` +
      `${availablePaths.size} public files, and ${zeroLiteralEntries.length} zero-literal entries validated.`,
  );
  console.log(
    `Zero-literal classification — ${dynamicEntries} dynamic app targets; ` +
      `${offlineOnlyEntries} retained by the full offline fallback contract.`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) await run();
