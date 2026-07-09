/**
 * Quotation view's tabbed shell. Thin per-view wrapper that binds the shared
 * AnalysisTabsHost to the quotation tab group + panel, so this view gets the
 * exact same tab UI/behaviour as every other analysis view.
 *
 * Rendered by: ViewRouter via the ``quotation`` entry in VIEW_COMPONENTS.
 */
import { AnalysisTabsHost } from '../common/tabs/AnalysisTabsHost';
import { ANALYSIS_TAB_GROUPS } from '../common/analysisIds';
import QuotationFeature from './QuotationFeature';

function QuotationTabbedFeature() {
  return <AnalysisTabsHost tabGroup={ANALYSIS_TAB_GROUPS.quotation} Feature={QuotationFeature} />;
}

export default QuotationTabbedFeature;
