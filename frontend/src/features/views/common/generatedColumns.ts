export const CONCORDANCE_CORE_COLUMNS = [
  'CONC_left_context',
  'CONC_matched_text',
  'CONC_right_context',
  'CONC_start_idx',
  'CONC_end_idx',
  'CONC_l1',
  'CONC_r1',
] as const;

export const CONCORDANCE_FREQ_COLUMNS = ['CONC_l1_freq', 'CONC_r1_freq'] as const;

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

export const CONCORDANCE_RUN_ALL_GENERATED_COLUMNS = [
  ...CONCORDANCE_CORE_COLUMNS,
  ...CONCORDANCE_FREQ_COLUMNS,
  CONCORDANCE_COLUMN_KEYS.extraction,
] as const;

export const CONCORDANCE_PRESENTATION_COLUMNS = [
  ...CONCORDANCE_RUN_ALL_GENERATED_COLUMNS,
  CONCORDANCE_DISPERSION_COLUMN,
] as const;

export const CONCORDANCE_PRESENTATION_COLUMN_SET: ReadonlySet<string> = new Set(
  CONCORDANCE_PRESENTATION_COLUMNS,
);

export const QUOTATION_COLUMN_KEYS = {
  // Canonical name for the per-quote-row raw source-document text.
  // Detached output may include `QUOTE_extraction`; the live result table
  // renders it as a virtual column backed by the selected source text column.
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
