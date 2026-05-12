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