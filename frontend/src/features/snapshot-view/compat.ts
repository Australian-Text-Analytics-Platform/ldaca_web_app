/**
 * Default predicate: a snapshot is compatible with the current
 * build when their MAJOR.MINOR match (e.g. ``0.4.x`` opens in any
 * ``0.4.x``; ``0.3.x`` and ``0.5.x`` do not). The
 * ``TOOL_COMPATIBILITY`` registry holds per-tool overrides — empty in
 * v1, populated as tools stabilise and their snapshot format
 * stays stable across version bumps.
 *
 * The "stale" set (for batch delete) is the complement of the
 * compatible set, by definition — anything the build can't open
 * IS what the user should be able to clear with one click.
 */
import type { SnapshotToolKey } from './types';

interface ToolCompatibilityRule {
  /** Explicit list of MAJOR.MINOR versions the current build can open
   * for this tool. When present, overrides the default same-version
   * rule for this tool only. */
  compatibleMinorVersions: string[];
}

/** Per-tool compatibility overrides. v1 is empty — every tool falls
 * back to "same MAJOR.MINOR". Populate as tools stabilise:
 *
 *     concordance: { compatibleMinorVersions: ['0.4', '0.5'] }
 *
 * If a tool's rule grows beyond a trivial list (e.g. "any 0.4.x or
 * 0.5.x but not 0.4.0"), promote it to a predicate function — the
 * call site through ``isCompatibleSnapshot`` will absorb the change
 * without dragging the rest of the registry along. */
export const TOOL_COMPATIBILITY: Partial<Record<SnapshotToolKey, ToolCompatibilityRule>> = {};

/** Return ``"<MAJOR>.<MINOR>"`` from a version string, or ``null``
 * if malformed. Accepts ``"v0.4.4"``, ``"0.4.4"``, ``"0.4"``,
   * ``"0.4.0-rc1"`` etc.  * Used by: index module, compat tests (rg call sites/imports).
   * Why: because snapshot loading needs coarse version compatibility gates before unsupported bundles hydrate feature state.
   */
export function parseMajorMinor(version: string | null | undefined): string | null {
  if (typeof version !== 'string') return null;
  const m = version.trim().match(/^v?(\d+)\.(\d+)(?:\.\d+)?(?:[-+].*)?$/);
  if (!m) return null;
  return `${m[1]}.${m[2]}`;
}

/** True when a snapshot of version ``snapshotVersion`` (typically
 * read from ``manifest.tool_version``) is openable by the current
 * build running at ``currentVersion``.  * Used by: index module, compat tests, LoadSnapshotDialog component (rg call sites/imports).
 * Why: because snapshot loading needs coarse version compatibility gates before unsupported bundles hydrate feature state.
 */
export function isCompatibleSnapshot(
  snapshotVersion: string,
  tool: SnapshotToolKey,
  currentVersion: string,
): boolean {
  const snap = parseMajorMinor(snapshotVersion);
  if (snap === null) return false;
  const override = TOOL_COMPATIBILITY[tool];
  if (override) return override.compatibleMinorVersions.includes(snap);
  const current = parseMajorMinor(currentVersion);
  if (current === null) return false;
  return snap === current;
}

/** Read the current build's version from the Vite-injected
 * ``VITE_APP_VERSION`` env var. Returns the empty string when
 * unavailable — callers should treat that as "version unknown" and
 * be defensive (the compat predicate returns false on an empty
 * current-version, which keeps the user from accidentally opening
 * a snapshot against an unknown build).  * Used by: useQuotationSnapshotCapture hook, useTokenFrequencySnapshotCapture hook, useConcordanceSnapshotCapture hook (rg call sites/imports).
 * Why: because snapshot loading needs coarse version compatibility gates before unsupported bundles hydrate feature state.
 */
export function getCurrentAppVersion(): string {
  return (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '';
}
