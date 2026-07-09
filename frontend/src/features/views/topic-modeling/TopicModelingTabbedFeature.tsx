/**
 * Topic-modeling view's tabbed shell. Thin per-view wrapper that binds the
 * shared AnalysisTabsHost to the topic-modeling tab group + panel, so this view
 * gets the exact same tab UI/behaviour as every other analysis view.
 *
 * Rendered by: ViewRouter via the ``topic-modeling`` entry in VIEW_COMPONENTS.
 */
import { AnalysisTabsHost } from '../common/tabs/AnalysisTabsHost';
import { ANALYSIS_TAB_GROUPS } from '../common/analysisIds';
import TopicModelingFeature from './TopicModelingFeature';

function TopicModelingTabbedFeature() {
  return (
    <AnalysisTabsHost tabGroup={ANALYSIS_TAB_GROUPS.topicModeling} Feature={TopicModelingFeature} />
  );
}

export default TopicModelingTabbedFeature;
