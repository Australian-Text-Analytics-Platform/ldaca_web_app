interface TopicModelingAddToWorkspaceColumnSource {
  id: string;
  documentColumn: string;
}

export function createDefaultTopicModelingAddToWorkspaceColumns(
  sources: TopicModelingAddToWorkspaceColumnSource[],
): Record<string, string[]> {
  return Object.fromEntries(sources.map((source) => [source.id, [source.documentColumn]]));
}
