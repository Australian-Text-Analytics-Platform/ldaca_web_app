export const CONCORDANCE_CORE_COLUMNS = [
  'CONC_left_context',
  'CONC_matched_text',
  'CONC_right_context',
  'CONC_start_idx',
  'CONC_end_idx',
  'CONC_l1',
  'CONC_r1',
] as const;

export const CONCORDANCE_FREQ_COLUMNS = [
  'CONC_l1_freq',
  'CONC_r1_freq',
] as const;

export const CONCORDANCE_MATERIALIZED_COLUMNS = [
  ...CONCORDANCE_CORE_COLUMNS,
  ...CONCORDANCE_FREQ_COLUMNS,
] as const;

export const CONCORDANCE_DISPERSION_COLUMN = 'CONC_dispersion' as const;

export const CONCORDANCE_COLUMN_KEYS = {
  leftContext: 'CONC_left_context',
  matchedText: 'CONC_matched_text',
  rightContext: 'CONC_right_context',
  startIdx: 'CONC_start_idx',
  endIdx: 'CONC_end_idx',
  leftToken: 'CONC_l1',
  rightToken: 'CONC_r1',
  leftTokenFreq: 'CONC_l1_freq',
  rightTokenFreq: 'CONC_r1_freq',
  dispersion: CONCORDANCE_DISPERSION_COLUMN,
  extraction: 'CONC_extraction',
} as const;

export const QUOTATION_COLUMN_KEYS = {
  // Canonical name for the per-quote-row raw source-document text.
  // The backend emits a real `QUOTE_extraction` column in materialised
  // parquets and (opt-in) in detach output; the live result table renders
  // it as a virtual column that substitutes the user's text column at
  // render time so the header stays consistent regardless of the source
  // column's name.
  document: 'QUOTE_extraction',
  speaker: 'QUOTE_speaker',
  speakerStartIdx: 'QUOTE_speaker_start_idx',
  speakerEndIdx: 'QUOTE_speaker_end_idx',
  quote: 'QUOTE_quote',
  quoteStartIdx: 'QUOTE_quote_start_idx',
  quoteEndIdx: 'QUOTE_quote_end_idx',
  verb: 'QUOTE_verb',
  verbStartIdx: 'QUOTE_verb_start_idx',
  verbEndIdx: 'QUOTE_verb_end_idx',
  quoteType: 'QUOTE_quote_type',
  quoteTokenCount: 'QUOTE_quote_token_count',
  isFloatingQuote: 'QUOTE_is_floating_quote',
  quoteRowIdx: 'QUOTE_quote_row_idx',
} as const;

export const QUOTATION_DOCUMENT_COLUMN = QUOTATION_COLUMN_KEYS.document;

export const TOPIC_COLUMN_KEYS = {
  topic: 'TOPIC_topic',
  topicMeaning: 'TOPIC_topic_meaning',
} as const;

// Columns the result-table viewer should hide from display. The data is
// still useful for highlighting and as a column on detached data blocks,
// but the raw character indices add noise to the on-screen table.
export const HIDDEN_RESULT_TABLE_COLUMNS = new Set<string>([
  CONCORDANCE_COLUMN_KEYS.startIdx,
  CONCORDANCE_COLUMN_KEYS.endIdx,
]);

// Tool-specific column-name prefixes are useful when these columns land
// on a data block in the workspace (so they don't collide with user
// columns), but they're noise in the on-screen result table. Strip a
// known prefix; leave anything else untouched (e.g. metadata columns).
const TABLE_LABEL_PREFIXES = ['CONC_', 'QUOTE_', 'TOPIC_'];

export function formatResultTableHeader(columnKey: string): string {
  for (const prefix of TABLE_LABEL_PREFIXES) {
    if (columnKey.startsWith(prefix)) return columnKey.slice(prefix.length);
  }
  return columnKey;
}