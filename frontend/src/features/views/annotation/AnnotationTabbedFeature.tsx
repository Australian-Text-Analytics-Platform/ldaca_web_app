/**
 * Annotation view's tabbed shell. It binds the shared analysis tab host to the
 * annotation tab group so the view uses the same tab strip and persisted input
 * state contract as the other analysis-style tools.
 *
 * Rendered by: ViewRouter via the ``annotation`` entry in VIEW_COMPONENTS.
 */
import { AnalysisTabsHost } from '../common/tabs/AnalysisTabsHost';
import { ANALYSIS_TAB_GROUPS } from '../common/analysisIds';
import AnnotationFeature from './AnnotationFeature';

function AnnotationTabbedFeature() {
  return <AnalysisTabsHost tabGroup={ANALYSIS_TAB_GROUPS.annotation} Feature={AnnotationFeature} />;
}

export default AnnotationTabbedFeature;
