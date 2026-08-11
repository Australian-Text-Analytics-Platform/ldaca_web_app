# Focused Per-Class Annotation Example Sampling

Issue: [#48](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/48)

Status: completed 2026-08-12.

## Accepted behavior

- AI Annotation optionally draws examples from the selected Example Data Block.
- Each immutable Annotation request records a maximum examples per class, a
  `random`, `first_n`, or `last_n` method, and a nonnegative random seed.
- Defaults are 10 examples per class, random sampling, and seed 0.
- Blank text or label values are discarded after trimming. Exact,
  case-sensitive labels form groups in first-seen order, including labels not
  present in the Codebook.
- Short groups contribute every usable row. First and last sampling preserve
  row order; random sampling uses one request-local seeded generator without
  replacement. Selected groups are concatenated in first-seen order.
- Preview reconstructs the same subset from its immutable snapshot for every
  page query. Run All selects once and reuses that list for every provider
  batch, retry, and recursive split.
- The three controls are Tab settings, restore from retained requests, and are
  disabled until the Example Data Block selection is complete or while
  Analysis parameters are locked.

## Compatibility boundary

Native Workspace schema 17 and portable archive format 16 are strict cutovers.
Earlier versions are rejected without runtime migration.

## Non-goals

- Total-example ceilings or coverage warnings.
- Target-row contamination handling or token-budget adaptation.
- Example transparency or variability disclaimers.
- An ADR for this reversible request and presentation behavior.
