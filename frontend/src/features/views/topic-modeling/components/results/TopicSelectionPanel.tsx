import type { TopicModelingTopic } from '@/api';
import { Search, X } from 'lucide-react';
import { matchChecklistOption } from '@/features/views/common/checklistSearch';
import { topicRepresentativeText } from '../../topicModelingAdapters';
import { TopicSizeComposition, type TopicCorpusPresentation } from './TopicSizeComposition';

interface Props {
  topics: TopicModelingTopic[];
  selectedTopicIds: Set<number>;
  onToggleTopicSelection: (id: number) => void;
  onClearSelection: () => void;
  topicSearchQuery: string;
  onTopicSearchQueryChange: (query: string) => void;
  lassoTopicIds: Set<number>;
  corpusPresentation: TopicCorpusPresentation;
  hoveredTopicId: number | null;
  onHoveredTopicChange: (topicId: number | null) => void;
}

/**
 * Renders selected and available topic lists beneath the bubble chart.
 * Rendered by: TopicModelingBubbleChartSection, which shares list hover,
 * selection, search, and lasso-filter state with the chart.
 * Flow: sort by size, intersect lasso and search filters, then project list hover
 * into bubble emphasis while keeping bubble hover local to the graph node.
 */
export function TopicSelectionPanel({
  topics,
  selectedTopicIds,
  onToggleTopicSelection,
  onClearSelection,
  topicSearchQuery,
  onTopicSearchQueryChange,
  lassoTopicIds,
  corpusPresentation,
  hoveredTopicId,
  onHoveredTopicChange,
}: Props) {
  const sortedTopics = topics.toSorted((a, b) => b.total_size - a.total_size);
  const hasLassoFilter = lassoTopicIds.size > 0;

  const filteredTopics = sortedTopics.filter((topic) => {
    if (hasLassoFilter && !lassoTopicIds.has(topic.id)) return false;
    if (topicSearchQuery.trim()) {
      return matchChecklistOption(topicRepresentativeText(topic), topicSearchQuery);
    }
    return true;
  });

  const selectedTopics = sortedTopics.filter((t) => selectedTopicIds.has(t.id));

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* Left column: selected topics */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-body font-medium text-foreground">
            Selected Topics ({selectedTopics.length})
          </h4>
          {selectedTopics.length > 0 && (
            <button
              type="button"
              onClick={onClearSelection}
              className="text-label-secondary text-description hover:text-foreground"
            >
              Clear all
            </button>
          )}
        </div>
        {selectedTopics.length === 0 ? (
          <p className="text-label-secondary text-description italic">
            Click topics in the chart or list to prioritize them in the chart export.
          </p>
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {selectedTopics.map((topic) => {
              const isHovered = hoveredTopicId === topic.id;
              return (
                <div
                  key={topic.id}
                  className={`flex items-center justify-between rounded-lg border border-surface-border p-2 transition-colors ${isHovered ? 'bg-list-hover' : 'bg-panel/50'}`}
                  onMouseEnter={() => {
                    onHoveredTopicChange(topic.id);
                  }}
                  onMouseLeave={() => {
                    onHoveredTopicChange(null);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-body font-medium text-foreground">Topic {topic.id}</span>
                    <div
                      className="truncate text-label-secondary text-description"
                      title={topicRepresentativeText(topic)}
                    >
                      {topicRepresentativeText(topic)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ml-2 shrink-0 rounded-sm p-0.5 text-description hover:bg-error/10 hover:text-error"
                    onClick={() => {
                      onToggleTopicSelection(topic.id);
                    }}
                    aria-label={`Remove topic ${String(topic.id)}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right column: all topics (filtered) */}
      <div className="space-y-2">
        <h4 className="text-body font-medium text-foreground">
          All Topics (
          {hasLassoFilter
            ? `${String(filteredTopics.length)} of ${String(topics.length)}`
            : filteredTopics.length}
          )
        </h4>
        <div className="relative">
          <Search className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-description" />
          <input
            type="text"
            value={topicSearchQuery}
            onChange={(e) => {
              onTopicSearchQueryChange(e.target.value);
            }}
            placeholder="Search representative words…"
            className="h-8 w-full rounded-md border border-input-border bg-editor pl-8 pr-3 text-label-secondary placeholder:text-description focus:border-focus focus:ring-1 focus:ring-focus focus:outline-hidden"
          />
        </div>
        <div className="max-h-70 space-y-1 overflow-y-auto">
          {filteredTopics.map((topic) => {
            const isSelected = selectedTopicIds.has(topic.id);
            const isHovered = hoveredTopicId === topic.id;
            return (
              <div
                key={topic.id}
                role="button"
                tabIndex={0}
                className={`cursor-pointer rounded-lg border p-2 transition-colors ${
                  isSelected
                    ? 'border-l-[3px] border-l-green-500 border-[var(--vscode-charts-green)] bg-[color-mix(in_srgb,var(--vscode-charts-green)_12%,transparent)]/60'
                    : 'border-surface-border/60 bg-surface'
                } ${isHovered ? (isSelected ? 'bg-[color-mix(in_srgb,var(--vscode-charts-green)_12%,transparent)]/80' : 'bg-list-hover/70') : ''}`}
                onClick={() => {
                  onToggleTopicSelection(topic.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggleTopicSelection(topic.id);
                  }
                }}
                onMouseEnter={() => {
                  onHoveredTopicChange(topic.id);
                }}
                onMouseLeave={() => {
                  onHoveredTopicChange(null);
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-body font-medium text-foreground">Topic {topic.id}</span>
                  <TopicSizeComposition
                    sizes={topic.size}
                    total={topic.total_size}
                    {...corpusPresentation}
                  />
                </div>
                <div
                  className="mt-0.5 truncate text-label-secondary text-description"
                  title={topicRepresentativeText(topic)}
                >
                  {topicRepresentativeText(topic)}
                </div>
              </div>
            );
          })}
          {filteredTopics.length === 0 && (
            <p className="py-4 text-center text-label-secondary text-description italic">
              No topics match the current filters.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
