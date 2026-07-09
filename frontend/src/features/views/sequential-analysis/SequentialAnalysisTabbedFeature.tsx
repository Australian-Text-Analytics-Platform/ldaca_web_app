/**
 * Sequential-analysis (Trends) view's tabbed shell. Thin per-view wrapper that
 * binds the shared AnalysisTabsHost to the sequential-analysis tab group +
 * panel, so this view gets the exact same tab UI/behaviour as every other
 * analysis view.
 *
 * Rendered by: ViewRouter via the ``analysis`` entry in VIEW_COMPONENTS.
 */
import { AnalysisTabsHost } from '../common/tabs/AnalysisTabsHost';
import { ANALYSIS_TAB_GROUPS } from '../common/analysisIds';
import SequentialAnalysisFeature from './SequentialAnalysisFeature';

function SequentialAnalysisTabbedFeature() {
  return (
    <AnalysisTabsHost
      tabGroup={ANALYSIS_TAB_GROUPS.sequential}
      Feature={SequentialAnalysisFeature}
    />
  );
}

export default SequentialAnalysisTabbedFeature;
