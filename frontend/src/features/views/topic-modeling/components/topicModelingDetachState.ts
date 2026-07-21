interface TopicModelingDetachColumnSource {
  id: string;
  documentColumn: string;
}

export function createDefaultTopicModelingDetachColumns(
  sources: TopicModelingDetachColumnSource[],
): Record<string, string[]> {
  return Object.fromEntries(sources.map((source) => [source.id, [source.documentColumn]]));
}
