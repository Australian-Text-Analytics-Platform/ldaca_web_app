/**
 * Quotation view's tabbed shell. Thin per-view wrapper that binds the shared
 * AnalysisTabsHost to the quotation tab group + panel, so this view gets the
 * exact same tab UI/behaviour as every other analysis view.
 *
 * Rendered by: ViewRouter via the ``quotation`` entry in VIEW_COMPONENTS.
 */
import { AnalysisTabsHost } from '../common/tabs/AnalysisTabsHost';
import QuotationFeature from './QuotationFeature';

/** Tab-group namespace for quotation tabs (matches the backend analysis type). */
const QUOTATION_TAB_GROUP = 'quotation_analysis';

function QuotationTabbedFeature() {
  return <AnalysisTabsHost tabGroup={QUOTATION_TAB_GROUP} Feature={QuotationFeature} />;
}

export default QuotationTabbedFeature;
