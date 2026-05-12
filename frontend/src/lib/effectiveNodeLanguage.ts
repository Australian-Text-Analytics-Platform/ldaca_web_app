/**
 * Phase 4 frontend mirror of the backend ``effective_language`` resolver:
 * pick the language a per-tool UI should treat the active node as. The
 * frontend version differs from the backend in only one way — when both
 * an explicit override AND a node lookup are available, we still prefer
 * the explicit override so user intent wins.
 *
 * Resolution order:
 *   1. ``explicit`` — caller-supplied string (e.g. selector value).
 *   2. ``node.derived[*].language`` — language tagged on any derived
 *      column registered on this node. The Tokenise operation records
 *      this, so once a user has tokenised, the corpus language is known.
 *   3. ``defaultLanguage`` — per-user preference from the store.
 *   4. ``"en"`` — global fallback so existing English flows stay quiet.
 */
import type { DerivedColumnMeta } from '@/types';

export const DEFAULT_LANGUAGE = 'en';

/**
 * Structural minimum the resolver needs from a node. Both
 * ``WorkspaceNode`` and the looser ``WorkspaceNodeLike`` (``Record<string,
 * unknown>`` for backend payloads that may omit fields) satisfy this
 * via the index signature — ``derived`` is read defensively, so any
 * shape that surfaces it will work.
 */
export type NodeLikeWithDerived = {
  derived?: Record<string, DerivedColumnMeta> | unknown;
  [key: string]: unknown;
};

function normalise(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

function readLanguageFromDerived(derived: unknown): string | null {
  if (!derived || typeof derived !== 'object') return null;
  for (const meta of Object.values(derived as Record<string, unknown>)) {
    if (!meta || typeof meta !== 'object') continue;
    const lang = normalise((meta as { language?: unknown }).language as string | null);
    if (lang) return lang;
  }
  return null;
}

export function effectiveNodeLanguage(args: {
  explicit?: string | null;
  node?: NodeLikeWithDerived | null;
  defaultLanguage?: string | null;
}): string {
  const explicit = normalise(args.explicit);
  if (explicit) return explicit;

  const fromNode = readLanguageFromDerived(args.node?.derived);
  if (fromNode) return fromNode;

  const fallback = normalise(args.defaultLanguage);
  if (fallback) return fallback;
  return DEFAULT_LANGUAGE;
}

export function isEnglish(language: string): boolean {
  return normalise(language) === DEFAULT_LANGUAGE;
}
