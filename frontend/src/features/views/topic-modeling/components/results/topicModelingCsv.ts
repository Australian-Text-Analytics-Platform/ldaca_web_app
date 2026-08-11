import type { TopicModelingTopic } from '@/api';

const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** Build one CSV row per topic from the complete filtered candidate lists. */
export const buildTopicsCSV = (
  topics: TopicModelingTopic[],
  selectedTopicIds: Set<number>,
  nodeNames: string[],
): string => {
  const sorted = [...topics].sort((left, right) => {
    const leftSelected = selectedTopicIds.has(left.id) ? 0 : 1;
    const rightSelected = selectedTopicIds.has(right.id) ? 0 : 1;
    if (leftSelected !== rightSelected) return leftSelected - rightSelected;
    return left.id - right.id;
  });

  const hasMultipleCorpora = nodeNames.length >= 2;
  const headerColumns = ['Selected', 'Topic No', 'Representative Words', ...nodeNames];
  if (hasMultipleCorpora) headerColumns.push('Total');

  const rows = sorted.map((topic) => {
    const columns = [
      escapeCsv(selectedTopicIds.has(topic.id) ? 'Yes' : 'No'),
      escapeCsv(String(topic.id)),
      escapeCsv(
        topic.representative_words
          .map((term) => `${term.word} (${String(term.occurrence_count)})`)
          .join(', '),
      ),
    ];
    for (let index = 0; index < nodeNames.length; index += 1) {
      columns.push(escapeCsv(String(topic.size[index] ?? 0)));
    }
    if (hasMultipleCorpora) columns.push(escapeCsv(String(topic.total_size)));
    return columns.join(',');
  });

  return [headerColumns.map(escapeCsv).join(','), ...rows].join('\r\n');
};
