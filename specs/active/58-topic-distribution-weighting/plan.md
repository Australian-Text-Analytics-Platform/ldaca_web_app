# Implementation Plan

1. Add length-weighted Rust rollup tests and pass retained segment character
   lengths through the shared pipeline.
2. Replace row-replicated native output with one scalar run result containing
   independent document and topic lists.
3. Consume and strictly validate that result in the backend, including the
   Issue #58 case where a topic is present but never dominant.
4. Correct Topic Segment terminology and align glossary, domain, architecture,
   API, package, user documentation, and ADR 0023.
5. Run focused tests, complete package gates, synchronize publication docs, and
   perform live acceptance for all segmentation modes.
