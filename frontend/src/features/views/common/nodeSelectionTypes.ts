/**
 * One selected workspace node plus the feature-specific column chosen for it.
 * Used by: analysis task flows, result panels, and node-input hooks because
 * they share the same persisted `{nodeId, column}` selection shape.
 */
export interface NodeColumnSelection {
  nodeId: string;
  column: string;
}
