# Implementation plan

1. Extend the native chunker and Polars expression with explicit segmentation
   methods, token-safe right truncation, and a run-level truncation count.
2. Add strict backend request fields and optional Result metadata, forward the
   settings through the worker, and regenerate the frontend API client.
3. Add persistent frontend controls and a Result warning while preserving the
   existing Analysis lifecycle and Clear Results conventions.
4. Update the domain glossary, decision record, engineering references, and
   source-verified user documentation, then recapture the live screenshots.
5. Run focused tests followed by all required package and documentation gates.

## Risks

- UAX #29 is deterministic and multilingual but is not language-aware; common
  abbreviations may form separate Topic Segments.
- Automatic reruns can change because the old punctuation heuristic is
  replaced by UAX #29.
- Token offsets must be converted to UTF-8-safe prefix boundaries so the text
  used by embeddings and c-TF-IDF remains identical.
