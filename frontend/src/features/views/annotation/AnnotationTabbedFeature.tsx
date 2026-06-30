/**
 * Annotation view's tabbed shell. It binds the shared analysis tab host to the
 * annotation tab group so the view uses the same tab strip and persisted input
 * state contract as the other analysis-style tools.
 *
 * Rendered by: ViewRouter via the ``annotation`` entry in VIEW_COMPONENTS.
 */
import { AnalysisTabsHost } from '../common/tabs/AnalysisTabsHost';
import AnnotationFeature from './AnnotationFeature';

/** Tab-group namespace for annotation tabs. */
const ANNOTATION_TAB_GROUP = 'annotation';

function AnnotationTabbedFeature() {
  return <AnalysisTabsHost tabGroup={ANNOTATION_TAB_GROUP} Feature={AnnotationFeature} />;
}

export default AnnotationTabbedFeature;
