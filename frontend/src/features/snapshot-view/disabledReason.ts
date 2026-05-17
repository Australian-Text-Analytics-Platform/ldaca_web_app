/**
 * Canonical "this control is disabled because you're viewing a demo
 * snapshot" tooltip text. All five analysis tools — concordance,
 * quotation, sequential-analysis, token-frequency, topic-modeling —
 * share this string so users see a consistent reminder when they
 * hover over a frozen control: the snapshot is read-only, exit the
 * demo to interact.
 *
 * Pair with ``<DisabledReasonTooltip reason={...}>`` (NOT plain
 * ``title=``) so the tooltip pops without the browser's 1–2 second
 * native delay.
 */
export const SNAPSHOT_DISABLED_REASON =
  'Disabled in snapshot view — exit demo mode to use this control.';

/** Convenience: returns the canonical reason when ``inSnapshotMode``
 * is true, otherwise returns the first non-empty fallback reason
 * (or ``undefined`` if none). Lets call sites compose snapshot
 * disabling with tool-specific disable reasons in one expression:
 *
 *   const reason = snapshotDisabledReason(inSnapshotMode,
 *     !hasResult && 'Run the analysis first.',
 *     !isSelectionValid && 'Select a time period.',
 *   );
 *   <DisabledReasonTooltip reason={reason}>...</DisabledReasonTooltip>
 *
 * Snapshot mode takes precedence over other reasons because exiting
 * demo mode is the prerequisite for everything else mattering. */
export function snapshotDisabledReason(
  inSnapshotMode: boolean,
  ...fallbackReasons: Array<string | false | null | undefined>
): string | undefined {
  if (inSnapshotMode) return SNAPSHOT_DISABLED_REASON;
  for (const r of fallbackReasons) {
    if (typeof r === 'string' && r.length > 0) return r;
  }
  return undefined;
}
