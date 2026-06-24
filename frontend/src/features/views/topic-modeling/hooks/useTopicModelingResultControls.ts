import { useCallback, useReducer } from 'react';

import type { TopicModelingTopic } from '@/api';

interface TopicTooltipState {
  x: number;
  y: number;
  topic: TopicModelingTopic | null;
}

interface TopicModelingResultControlState {
  hoveredTopicId: number | null;
  tooltip: TopicTooltipState;
  selectedTopicIds: Set<number>;
  topicSearchQuery: string;
}

export type TopicModelingResultControlAction =
  | { type: 'hoveredTopicChanged'; value: React.SetStateAction<number | null> }
  | { type: 'tooltipChanged'; value: React.SetStateAction<TopicTooltipState> }
  | { type: 'topicSelectionToggled'; id: number }
  | { type: 'topicSelectionCleared' }
  | { type: 'topicSearchChanged'; query: string };

const initialTooltip: TopicTooltipState = {
  x: 0,
  y: 0,
  topic: null,
};

/**
 * Creates reducer-owned state for topic-modeling result controls.
 * Used by: useTopicModelingResultControls hook.
 * Why: because hover, tooltip, selection, and search are all result-view
 * interactions and should move together when the result surface resets.
 */
export const createTopicModelingResultControlState = (): TopicModelingResultControlState => ({
  hoveredTopicId: null,
  tooltip: initialTooltip,
  selectedTopicIds: new Set(),
  topicSearchQuery: '',
});

const resolveStateAction = <T>(action: React.SetStateAction<T>, previous: T): T =>
  typeof action === 'function' ? (action as (current: T) => T)(previous) : action;

/**
 * Reduces local result-view interactions for topic modeling.
 * Used by: useTopicModelingResultControls and tests.
 * Flow: chart hover updates tooltip state, topic clicks toggle the selected set,
 * and search changes remain independent of backend task lifecycle.
 */
export const topicModelingResultControlReducer = (
  state: TopicModelingResultControlState,
  action: TopicModelingResultControlAction,
): TopicModelingResultControlState => {
  switch (action.type) {
    case 'hoveredTopicChanged':
      return {
        ...state,
        hoveredTopicId: resolveStateAction(action.value, state.hoveredTopicId),
      };
    case 'tooltipChanged':
      return {
        ...state,
        tooltip: resolveStateAction(action.value, state.tooltip),
      };
    case 'topicSelectionToggled': {
      const selectedTopicIds = new Set(state.selectedTopicIds);
      if (selectedTopicIds.has(action.id)) selectedTopicIds.delete(action.id);
      else selectedTopicIds.add(action.id);
      return { ...state, selectedTopicIds };
    }
    case 'topicSelectionCleared':
      return state.selectedTopicIds.size === 0 ? state : { ...state, selectedTopicIds: new Set() };
    case 'topicSearchChanged':
      return state.topicSearchQuery === action.query
        ? state
        : { ...state, topicSearchQuery: action.query };
    default:
      return state;
  }
};

/**
 * Owns topic-modeling result-panel interaction state.
 * Used by: TopicModelingFeature.
 * Flow: expose React-setter-compatible hover/tooltip callbacks for chart hooks,
 * plus named topic selection and search actions for the results panel.
 */
export const useTopicModelingResultControls = () => {
  const [state, dispatch] = useReducer(
    topicModelingResultControlReducer,
    undefined,
    createTopicModelingResultControlState,
  );

  const setHoveredTopicId = useCallback((value: React.SetStateAction<number | null>) => {
    dispatch({ type: 'hoveredTopicChanged', value });
  }, []);

  const setTooltip = useCallback((value: React.SetStateAction<TopicTooltipState>) => {
    dispatch({ type: 'tooltipChanged', value });
  }, []);

  const handleToggleTopicSelection = useCallback((id: number) => {
    dispatch({ type: 'topicSelectionToggled', id });
  }, []);

  const handleClearTopicSelection = useCallback(() => {
    dispatch({ type: 'topicSelectionCleared' });
  }, []);

  const setTopicSearchQuery = useCallback((query: string) => {
    dispatch({ type: 'topicSearchChanged', query });
  }, []);

  return {
    ...state,
    setHoveredTopicId,
    setTooltip,
    handleToggleTopicSelection,
    handleClearTopicSelection,
    setTopicSearchQuery,
  };
};
