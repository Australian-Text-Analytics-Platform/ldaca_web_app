import { useReducer } from 'react';

interface TopicModelingResultControlState {
  selectedTopicIds: Set<number>;
  topicSearchQuery: string;
}

export type TopicModelingResultControlAction =
  | { type: 'topicSelectionToggled'; id: number }
  | { type: 'topicSelectionCleared' }
  | { type: 'topicSearchChanged'; query: string };

/**
 * Creates reducer-owned state for topic-modeling result controls.
 * Used by: useTopicModelingResultControls hook.
 * Why: selection and search are result-view interactions that reset together.
 */
export const createTopicModelingResultControlState = (): TopicModelingResultControlState => ({
  selectedTopicIds: new Set(),
  topicSearchQuery: '',
});

/**
 * Reduces local result-view interactions for topic modeling.
 * Used by: useTopicModelingResultControls and tests.
 * Flow: topic clicks toggle the selected set and search changes remain
 * independent of backend task lifecycle.
 */
export const topicModelingResultControlReducer = (
  state: TopicModelingResultControlState,
  action: TopicModelingResultControlAction,
): TopicModelingResultControlState => {
  switch (action.type) {
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
 * Flow: expose named topic selection and search actions for the results panel.
 */
export const useTopicModelingResultControls = () => {
  const [state, dispatch] = useReducer(
    topicModelingResultControlReducer,
    undefined,
    createTopicModelingResultControlState,
  );

  const handleToggleTopicSelection = (id: number) => {
    dispatch({ type: 'topicSelectionToggled', id });
  };

  const handleClearTopicSelection = () => {
    dispatch({ type: 'topicSelectionCleared' });
  };

  const setTopicSearchQuery = (query: string) => {
    dispatch({ type: 'topicSearchChanged', query });
  };

  return {
    ...state,
    handleToggleTopicSelection,
    handleClearTopicSelection,
    setTopicSearchQuery,
  };
};
