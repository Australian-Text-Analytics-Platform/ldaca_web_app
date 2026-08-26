import { Collapsible as CollapsiblePrimitive } from 'radix-ui';

/** Collapsible root primitive used by sections that reveal or hide content. */
const Collapsible = CollapsiblePrimitive.Root;

/** Collapsible trigger primitive used by controls that toggle a section. */
const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger;

/** Collapsible content primitive used for the revealable section body. */
const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent;

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
