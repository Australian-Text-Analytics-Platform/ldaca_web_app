/**
 * Contextual onboarding hints (a.k.a. coach marks).
 *
 * A hint is a small popover bubble + highlight ring rendered next to a UI
 * element (looked up via `data-hint-id`) when a registered "trigger condition"
 * is currently true and the user has not dismissed it.
 */

/**
 * Closed set of conditions that can trigger a hint.
 *
 * Add new ids here, then implement them in `useHintConditions` and reference
 * them from one or more `HintDefinition` entries in `hintRegistry`.
 */
export type HintConditionId =
  | 'no-active-workspace'
  | 'workspace-has-no-nodes'
  | 'file-uploaded-not-added'
  | 'file-uploaded-no-workspace'
  | 'filter-no-node-selected'
  | 'filter-awaiting-column-selection';

export type HintConditionMap = Record<HintConditionId, boolean>;

/** Extra context the registry can use to resolve a parameterised anchor. */
export interface HintResolverContext {
  /** Path of the most recently uploaded file (if any). */
  lastUploadedFilePath: string | null;
}

export interface HintDefinition {
  /** Stable identifier used for dismissal persistence. */
  id: string;
  /** Short title shown in the bubble. */
  title: string;
  /** Body copy shown under the title. Plain text. */
  body: string;
  /** When this condition is `true`, the hint becomes eligible to show. */
  condition: HintConditionId;
  /**
 * Default anchor: a `data-hint-id` attribute value on a DOM element.
 * Use `resolveAnchor` for dynamic targets (e.g. a specific list row).
 */
  anchorHintId?: string;
  /**
   * Custom anchor resolver. Returns the element to highlight, or `null` if
   * the hint should be skipped this tick. Wins over `anchorHintId` when set.
   */
  resolveAnchor?: (ctx: HintResolverContext) => Element | null;
  /** Lower numbers show first. Defaults to 100. */
  priority?: number;
  /**
   * If true, "Got it" persists dismissal forever. Otherwise the user can
   * dismiss for the session only and the hint will reappear after reload
   * when the condition is true again. Defaults to `true`.
   */
  oneShot?: boolean;
  /** Optional CTA button label and handler shown alongside "Got it". */
  action?: {
    label: string;
    /** Called when the CTA is clicked. Bubble closes after the call. */
    run: () => void;
  };
  /**
   * If set, the bubble shows a "Learn more" link that opens the existing
   * tutorial dialog at the given registry key.
   */
  learnMoreTarget?: string;
  /** Preferred placement for the bubble relative to the anchor. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
}
