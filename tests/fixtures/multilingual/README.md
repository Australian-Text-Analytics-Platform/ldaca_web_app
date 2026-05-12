# Multilingual test fixtures

Regression-test fixtures for the pluggable-tokeniser / multilingual support work
(see [docs/pluggable-tokeniser/PLAN.md](../../../docs/pluggable-tokeniser/PLAN.md)
Phase 0.1).

Two collections, each with one file per language (`en`, `zh`, `ja`):

| Directory  | Purpose | Content |
|------------|---------|---------|
| `literary/` | Realistic varied corpus | Short excerpts from well-known public-domain works (Project Gutenberg for EN, Chinese classics + early-modern for ZH, Aozora Bunko-style for JA). Used for token-frequency, concordance, topic-modelling regression. |
| `udhr/`     | Parallel cross-language corpus | Selected articles from the Universal Declaration of Human Rights (1948, public domain). Same article numbers across all three languages; useful for cross-tokeniser comparison where the source content is held constant. |

## Schema

CSV with two columns: `id,text`. Each `text` is a single-line excerpt
(no embedded newlines) to keep CSV escaping trivial. Comma-and-quote-containing
text uses standard CSV double-quote escaping.

```csv
id,text
1,"All human beings are born free and equal in dignity and rights."
```

## Source notes

- **Literary**: excerpts are short, well-known opening passages or famous lines.
  All source works are out of copyright in their countries of origin. Texts are
  reproduced as closely to canonical as practical; minor orthographic variation
  is acceptable since these are regression fixtures, not authoritative editions.
- **UDHR**: text approximates the UN's official translations into each language.
  The Universal Declaration of Human Rights is public-domain UN-produced text.
  For the purpose of regression testing, exact wording does not have to match
  any specific edition — what matters is that the text is stable across runs.

## Why ~20 docs per file (not 100)

The plan originally targeted 100 docs per language. In practice ~20 hand-picked
documents per source give enough surface area for token frequency, concordance,
and small-corpus topic modelling regression tests without becoming unwieldy to
maintain. Expand on demand.
