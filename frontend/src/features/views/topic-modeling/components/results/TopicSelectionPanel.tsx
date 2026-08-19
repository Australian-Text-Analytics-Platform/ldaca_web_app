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
          <h4 className="text-sm font-medium text-foreground">
            Selected Topics ({selectedTopics.length})
          </h4>
          {selectedTopics.length > 0 && (
            <button
              type="button"
              onClick={onClearSelection}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          )}
        </div>
        {selectedTopics.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            Click topics in the chart or list to prioritize them in the chart export.
          </p>
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {selectedTopics.map((topic) => {
              const isHovered = hoveredTopicId === topic.id;
              return (
                <div
                  key={topic.id}
                  className={`flex items-center justify-between rounded-lg border border-border p-2 transition-colors ${isHovered ? 'bg-accent' : 'bg-muted/50'}`}
                  onMouseEnter={() => {
                    onHoveredTopicChange(topic.id);
                  }}
                  onMouseLeave={() => {
                    onHoveredTopicChange(null);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-foreground">Topic {topic.id}</span>
                    <div
                      className="truncate text-xs text-muted-foreground"
                      title={topicRepresentativeText(topic)}
                    >
                      {topicRepresentativeText(topic)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ml-2 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
        <h4 className="text-sm font-medium text-foreground">
          All Topics (
          {hasLassoFilter
            ? `${String(filteredTopics.length)} of ${String(topics.length)}`
            : filteredTopics.length}
          )
        </h4>
        <div className="relative">
          <Search className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={topicSearchQuery}
            onChange={(e) => {
              onTopicSearchQueryChange(e.target.value);
            }}
            placeholder="Search representative words…"
            className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-hidden"
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
                    ? 'border-l-[3px] border-l-green-500 border-green-200 bg-green-50/60 dark:border-green-800 dark:bg-green-950/20'
                    : 'border-border/60 bg-card'
                } ${isHovered ? (isSelected ? 'bg-green-100/80 dark:bg-green-950/30' : 'bg-accent/70') : ''}`}
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
                  <span className="text-sm font-medium text-foreground">Topic {topic.id}</span>
                  <TopicSizeComposition
                    sizes={topic.size}
                    total={topic.total_size}
                    {...corpusPresentation}
                  />
                </div>
                <div
                  className="mt-0.5 truncate text-xs text-muted-foreground"
                  title={topicRepresentativeText(topic)}
                >
                  {topicRepresentativeText(topic)}
                </div>
              </div>
            );
          })}
          {filteredTopics.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground italic">
              No topics match the current filters.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
