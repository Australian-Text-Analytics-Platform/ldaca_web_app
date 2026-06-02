/**
 * Topic-modeling view's tabbed shell. Thin per-view wrapper that binds the
 * shared AnalysisTabsHost to the topic-modeling tab group + panel, so this view
 * gets the exact same tab UI/behaviour as every other analysis view.
 *
 * Rendered by: ViewRouter via the ``topic-modeling`` entry in VIEW_COMPONENTS.
 */
import { AnalysisTabsHost } from '../common/tabs/AnalysisTabsHost';
import TopicModelingFeature from './TopicModelingFeature';

/** Tab-group namespace for topic-modeling tabs (matches the backend analysis type). */
const TOPIC_MODELING_TAB_GROUP = 'topic_modeling';

function TopicModelingTabbedFeature() {
  return <AnalysisTabsHost tabGroup={TOPIC_MODELING_TAB_GROUP} Feature={TopicModelingFeature} />;
}

export default TopicModelingTabbedFeature;
