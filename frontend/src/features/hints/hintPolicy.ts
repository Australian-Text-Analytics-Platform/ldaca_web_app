import type { HintConditionMap, HintDefinition, HintResolverContext } from './types';

export interface ActiveHint {
  hint: HintDefinition;
  target: Element;
}

interface HintPolicyInput {
  hints: readonly HintDefinition[];
  conditions: HintConditionMap;
  context: HintResolverContext;
  dismissedHints: readonly string[];
  sessionDismissedHints: readonly string[];
}

/** Resolves either a registry-specific anchor or the shared data attribute. */
function resolveAnchor(hint: HintDefinition, context: HintResolverContext): Element | null {
  if (hint.resolveAnchor) return hint.resolveAnchor(context);
  if (!hint.anchorHintId) return null;
  return document.querySelector(`[data-hint-id="${CSS.escape(hint.anchorHintId)}"]`);
}

/**
 * Chooses the first eligible hint in registry order. This is the sole policy
 * boundary for condition eligibility, durable/session dismissal, ordering,
 * and live DOM anchor availability.
 *
 * Used by: `HintsController` polling and policy tests.
 */
export function selectEligibleHint({
  hints,
  conditions,
  context,
  dismissedHints,
  sessionDismissedHints,
}: HintPolicyInput): ActiveHint | null {
  const dismissed = new Set([...dismissedHints, ...sessionDismissedHints]);
  for (const hint of hints) {
    if (dismissed.has(hint.id) || !conditions[hint.condition]) continue;
    const target = resolveAnchor(hint, context);
    if (target) return { hint, target };
  }
  return null;
}
