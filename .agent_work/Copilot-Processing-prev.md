# Copilot Processing

## Request

Remove quotation analysis from polars-text (Rust/PyO3) and replace it with the original Python quotation-tool (GenderGapTracker) as a git submodule in the backend.

## Analysis Summary

### Previous Tool Architecture (Python + spaCy)

The previous tool (`QuoteExtractor` class in `GenderGapTracker/nlp/english/quote_extractor.py`) uses **spaCy dependency parsing** with a **three-stage pipeline**:

1. **Syntactic Quotes** (`extract_syntactic_quotes`): Uses spaCy's `ccomp` dependency to find clausal complements of quote verbs, extracts speaker via `nsubj` dependency.
2. **Floating Quotes** (`extract_floating_quotes`): Finds sentences in double quotes that follow QCQSV/QCQVS/CSV quotes, inherits speaker from previous quote.
3. **Heuristic Quotes** (`extract_heuristic_quotes`): Regex-based fallback that finds text between `"` marks, uses `get_closest_verb` (5-token window) and `get_closest_speaker` (verb's nsubj child).

Final step: `find_global_duplicates` removes overlapping and < 4-word quotes.

### Current Tool Architecture (Rust + BERT POS tagger)

Single-pass approach:

1. Regex-based quote span detection
2. POS-tag-based verb/speaker search
3. Floating quote inheritance
4. Deduplication

### Key Differences Identified

| #   | Area                       | Previous (Python)                                                                        | Current (Rust)                                     | Impact                    |
| --- | -------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------- |
| 1   | **Text preprocessing**     | `utils.preprocess_text()` normalizes curly quotes to `"`, replaces `\n` with `.\n`, etc. | No preprocessing                                   | Different quote detection |
| 2   | **Quote verb list**        | Contains all conjugated forms (said, says, saying, told, etc.) ~200+ forms               | Only base forms (~100)                             | Many verbs missed         |
| 3   | **Verb search window**     | 5 tokens before/after, stops at `.` or `"`                                               | 200 character window, no stop at sentence boundary | Different verb matches    |
| 4   | **Speaker finding**        | Uses spaCy `nsubj` dependency                                                            | Walks tokens looking for PROPN/capitalized words   | Less accurate             |
| 5   | **Heuristic quote size**   | 6 < tokens < 100                                                                         | MIN_QUOTE_TOKEN_COUNT = 3                          | Different filtering       |
| 6   | **Dedup min words**        | Removes quotes with < 4 words                                                            | Only MIN_QUOTE_TOKEN_COUNT = 3 filter              | More small quotes kept    |
| 7   | **Floating quote trigger** | Only after QCQSV/QCQVS/CSV quote types                                                   | Any previous structured quote with speaker         | More floating quotes      |
| 8   | **Sentence segmentation**  | spaCy's sentence segmenter                                                               | Simple `.!?` splitting                             | Different boundaries      |
| 9   | **"according to"**         | Separate syntactic handling via `prep` dependency                                        | Simple token adjacency check                       | Less precise              |
| 10  | **Quote type computation** | Uses spaCy's `is_quote` attribute for precise QCQ positioning                            | Pure position-based                                | Different types           |

## Action Plan

### Phase 1: Quote Verb List Alignment

- [x] Compare verb lists
- [ ] Update `quote_verb.txt` to include all conjugated forms from previous tool

### Phase 2: Text Preprocessing

- [ ] Add text normalization (curly quotes → straight, newline handling) before processing

### Phase 3: Verb Search Logic

- [ ] Change verb window from 200 chars to token-count-based (5 tokens)
- [ ] Stop at sentence boundaries (`.`, `"`)
- [ ] Better handle "is"/"was"/"be" exclusion

### Phase 4: Heuristic Quote Filtering

- [ ] Change min quote token count to match previous tool (< 4 words removed in dedup)
- [ ] Add max quote size filter (< 100 tokens for heuristic)

### Phase 5: Floating Quote Logic

- [ ] Only trigger floating inheritance after QCQSV/QCQVS/CSV type quotes

### Phase 6: Deduplication

- [ ] Align dedup with previous tool (remove < 4 word quotes)

### Phase 7: Testing

- [ ] Run existing tests
- [ ] Verify output alignment
