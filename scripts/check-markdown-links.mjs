/**
 * Validate repository-owned Markdown links without third-party dependencies.
 *
 * Used by `pnpm docs:links` and CI so the centralized engineering context and
 * package-local user documentation cannot retain missing files or anchors.
 * The scanner deliberately excludes generated, vendored, dependency, and build
 * trees; those files have their own sources or are not maintained here.
 */

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set([
  ".agents",
  ".codex",
  ".git",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".venv",
  "__pycache__",
  "build",
  "dist",
  "node_modules",
  "target",
]);

function isMaintainedMarkdown(path) {
  const repoPath = relative(repositoryRoot, path).split(sep).join("/");
  const base = repoPath.slice(repoPath.lastIndexOf("/") + 1);
  const maintainedReadmes = new Set([
    "README.md",
    "backend/README.md",
    "frontend/README.md",
    "polars-text/README.md",
    "polars-source-utils/README.md",
  ]);
  return (
    base === "AGENTS.md" ||
    base === "CONTEXT.md" ||
    maintainedReadmes.has(repoPath) ||
    repoPath.startsWith("docs/") ||
    repoPath.startsWith("specs/") ||
    repoPath.startsWith("frontend/docs/") ||
    repoPath.startsWith("frontend/public/")
  );
}

function collectMarkdown(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectMarkdown(path, files);
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
      if (isMaintainedMarkdown(path)) files.push(path);
    }
  }
  return files;
}

function withoutCodeFences(markdown) {
  const lines = markdown.split(/\r?\n/);
  let fence = null;
  return lines
    .map((line) => {
      const match = /^\s*(```+|~~~+)/.exec(line);
      if (match) {
        if (fence === null) fence = match[1][0];
        else if (match[1][0] === fence) fence = null;
        return "";
      }
      return fence === null ? line : "";
    })
    .join("\n");
}

function githubSlug(rawHeading) {
  return rawHeading
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[\p{P}\p{S}]/gu, (character) =>
      character === "-" || character === "_" ? character : "",
    )
    .replace(/\s+/g, "-");
}

function documentAnchors(markdown) {
  const anchors = new Set();
  const occurrences = new Map();
  const visible = withoutCodeFences(markdown);
  for (const line of visible.split(/\r?\n/)) {
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const base = githubSlug(heading[1]);
    if (!base) continue;
    const count = occurrences.get(base) ?? 0;
    occurrences.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  for (const match of visible.matchAll(/<(?:a\s+name|[^>]+\sid)=["']([^"']+)["'][^>]*>/gi)) {
    anchors.add(match[1]);
  }
  return anchors;
}

function markdownTargets(markdown) {
  const visible = withoutCodeFences(markdown);
  const targets = [];
  const inline = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g;
  for (const match of visible.matchAll(inline)) targets.push(match[1] ?? match[2]);

  const reference = /^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm;
  for (const match of visible.matchAll(reference)) targets.push(match[1] ?? match[2]);

  const html = /<(?:a|img)\b[^>]+(?:href|src)=["']([^"']+)["'][^>]*>/gi;
  for (const match of visible.matchAll(html)) targets.push(match[1]);
  return targets;
}

function decodeTarget(rawTarget) {
  const withoutQuery = rawTarget.split("?", 1)[0];
  const hashIndex = withoutQuery.indexOf("#");
  const rawPath = hashIndex === -1 ? withoutQuery : withoutQuery.slice(0, hashIndex);
  const rawAnchor = hashIndex === -1 ? "" : withoutQuery.slice(hashIndex + 1);
  try {
    return {
      path: decodeURIComponent(rawPath),
      anchor: decodeURIComponent(rawAnchor).toLowerCase(),
    };
  } catch {
    return null;
  }
}

function isExternal(target) {
  return (
    target.startsWith("//") ||
    target.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  );
}

const markdownFiles = collectMarkdown(repositoryRoot).sort();
const anchorCache = new Map();
const failures = [];

for (const source of markdownFiles) {
  const markdown = readFileSync(source, "utf8");
  for (const rawTarget of markdownTargets(markdown)) {
    if (!rawTarget || isExternal(rawTarget)) continue;
    const decoded = decodeTarget(rawTarget);
    const sourceLabel = relative(repositoryRoot, source);
    if (decoded === null) {
      failures.push(`${sourceLabel}: invalid percent encoding in ${rawTarget}`);
      continue;
    }

    const sourcePath = relative(repositoryRoot, source).split(sep).join("/");
    const publicRootLink =
      sourcePath.startsWith("frontend/public/") &&
      decoded.path !== "" &&
      !decoded.path.startsWith(".");
    const linkBase = publicRootLink
      ? join(repositoryRoot, "frontend/public")
      : dirname(source);
    const target = decoded.path ? resolve(linkBase, decoded.path) : source;
    const relativeTarget = relative(repositoryRoot, target);
    if (relativeTarget === ".." || relativeTarget.startsWith(`..${sep}`)) {
      failures.push(`${sourceLabel}: link escapes repository: ${rawTarget}`);
      continue;
    }
    if (!existsSync(target)) {
      failures.push(`${sourceLabel}: missing target ${rawTarget}`);
      continue;
    }

    const metadata = lstatSync(target);
    if (metadata.isSymbolicLink()) {
      const realTarget = realpathSync(target);
      const realRelative = relative(repositoryRoot, realTarget);
      if (realRelative === ".." || realRelative.startsWith(`..${sep}`)) {
        failures.push(`${sourceLabel}: target symlink escapes repository: ${rawTarget}`);
        continue;
      }
    }
    if (!decoded.anchor) continue;
    if (!metadata.isFile() || extname(target).toLowerCase() !== ".md") {
      failures.push(`${sourceLabel}: anchor target is not Markdown: ${rawTarget}`);
      continue;
    }
    let anchors = anchorCache.get(target);
    if (anchors === undefined) {
      anchors = documentAnchors(readFileSync(target, "utf8"));
      anchorCache.set(target, anchors);
    }
    if (!anchors.has(decoded.anchor)) {
      failures.push(`${sourceLabel}: missing anchor ${rawTarget}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Markdown link check failed with ${failures.length} error(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Checked internal links in ${markdownFiles.length} Markdown files.`);
}
