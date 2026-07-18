import type { ContextualHintDefinition, GuidedTourDefinition } from './types';

/** This release intentionally ships the framework without production hints. */
export const contextualHintRegistry: readonly ContextualHintDefinition[] = [];

/** This release intentionally ships the framework without production tours. */
export const guidedTourRegistry: readonly GuidedTourDefinition[] = [];
