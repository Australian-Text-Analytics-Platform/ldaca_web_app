"""Adapter from the vendored quotation extractor into Polars analysis.

Wraps the GenderGapTracker QuoteExtractor to provide a Polars-compatible
interface matching the output format expected by quotation_core.py.

Used by local quotation Analysis execution and focused backend tests.

Flow: normalize source text, run the local extractor, preserve source-row
    mappings, and return canonical grouped quotation values.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import polars as pl

from .quotation_core import QUOTATION_GROUP_COLUMN, QUOTATION_GROUP_DTYPE

_ENGLISH_DIR = Path(__file__).resolve().parents[1] / "_vendor" / "gender_gap_tracker"
_QUOTE_VERBS_PATH = _ENGLISH_DIR / "rules" / "quote_verb_list.txt"
_SPACY_MODEL = "en_core_web_md"

_extractor = None


def _load_spacy_model():
    """Load the locked quotation model as a normal installed spaCy package."""
    import spacy

    return spacy.load(_SPACY_MODEL)


def _get_extractor():
    """Lazy-load spaCy model and QuoteExtractor (expensive, cached)."""
    global _extractor

    if _extractor is not None:
        return _extractor

    from .._vendor.gender_gap_tracker.quote_extractor import QuoteExtractor

    _extractor = QuoteExtractor(_QUOTE_VERBS_PATH, _load_spacy_model())
    return _extractor


_INDEX_RE = re.compile(r"\((\d+),(\d+)\)")


_ACCENT_TRANSLATION = str.maketrans(
    {
        character: replacement
        for characters, replacement in (
            ("àáâãäåā", "a"),
            ("èéêëē", "e"),
            ("ìíîïıī", "i"),
            ("òóôõöō", "o"),
            ("ùúûüū", "u"),
            ("ýÿȳ", "y"),
            ("ç", "c"),
            ("ğḡ", "g"),
            ("ñ", "n"),
            ("ş", "s"),
            ("ÀÁÂÃÄÅĀ", "A"),
            ("ÈÉÊËĒ", "E"),
            ("ÌÍÎÏİĪ", "I"),
            ("ÒÓÔÕÖŌ", "O"),
            ("ÙÚÛÜŪ", "U"),
            ("ÝŸȲ", "Y"),
            ("Ç", "C"),
            ("ĞḠ", "G"),
            ("Ñ", "N"),
            ("Ş", "S"),
        )
        for character in characters
    }
)


def _remove_accents(txt: str) -> str:
    """Apply the quotation tool's length-preserving accent normalization."""

    return txt.translate(_ACCENT_TRANSLATION)


def _parse_index(value: str) -> tuple[int | None, int | None]:
    """Parse '(start,end)' string into (start, end) integers."""
    if not value:
        return None, None
    m = _INDEX_RE.match(value)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None, None


def _translate_span(
    start: int | None,
    end: int | None,
    mapping: list[int],
) -> tuple[int | None, int | None]:
    """Translate a preprocessed-text (start, end) span to original-text offsets.

    `mapping[i]` holds the original-text index corresponding to preprocessed
    position `i`, with `mapping` having length `len(preprocessed) + 1` so that
    the exclusive end offset can be resolved at `mapping[end]`.
    """
    if start is None or end is None:
        return start, end
    last = len(mapping) - 1
    orig_start = mapping[min(max(start, 0), last)]
    orig_end = mapping[min(max(end, 0), last)]
    if orig_end < orig_start:
        orig_end = orig_start
    return orig_start, orig_end


def _normalize_quote(
    raw: dict[str, Any],
    row_idx: int,
    mapping: list[int],
) -> dict[str, Any]:
    """Convert QuoteExtractor output dict to the canonical field format.

    Indices from the extractor refer to the preprocessed text; `mapping`
    translates them back into original-text offsets so downstream callers can
    slice the untouched source string.
    """
    speaker_start, speaker_end = _translate_span(
        *_parse_index(raw.get("speaker_index", "")), mapping
    )
    quote_start, quote_end = _translate_span(
        *_parse_index(raw.get("quote_index", "")), mapping
    )
    verb_start, verb_end = _translate_span(
        *_parse_index(raw.get("verb_index", "")), mapping
    )

    return {
        "speaker": raw.get("speaker") or None,
        "speaker_start_idx": speaker_start,
        "speaker_end_idx": speaker_end,
        "quote": raw.get("quote") or None,
        "quote_start_idx": quote_start,
        "quote_end_idx": quote_end,
        "verb": raw.get("verb") or None,
        "verb_start_idx": verb_start,
        "verb_end_idx": verb_end,
        "quote_type": raw.get("quote_type") or None,
        "quote_token_count": raw.get("quote_token_count"),
        "is_floating_quote": raw.get("is_floating_quote", False),
        "quote_row_idx": row_idx,
    }


_LENGTH_CHANGING_REPLACEMENTS: tuple[tuple[str, str], ...] = (
    ("\n", ".\n "),
    ("..\n ", ".\n "),
    (". .\n ", ".\n "),
    ("  ", " "),
    ("\\n", " "),
    ("\\n\\n", " "),
)


def _apply_replace_with_mapping(
    chars: list[str],
    mapping: list[int],
    old: str,
    new: str,
) -> tuple[list[str], list[int]]:
    """Replace all non-overlapping occurrences of `old` with `new`, tracking
    the original-text index for each output character.

    `mapping[i]` is the original-text index associated with `chars[i]`, with a
    trailing sentinel at position `len(chars)` giving the original end offset.
    """
    out_chars: list[str] = []
    out_map: list[int] = []
    old_len = len(old)
    new_len = len(new)
    n = len(chars)
    i = 0
    while i < n:
        if (
            old_len > 0
            and i + old_len <= n
            and chars[i] == old[0]
            and "".join(chars[i : i + old_len]) == old
        ):
            base_orig = mapping[i]
            for k in range(new_len):
                out_chars.append(new[k])
                out_map.append(base_orig)
            i += old_len
        else:
            out_chars.append(chars[i])
            out_map.append(mapping[i])
            i += 1
    out_map.append(mapping[n])
    return out_chars, out_map


def _preprocess_with_mapping(txt: str) -> tuple[str, list[int]]:
    """Apply quotation-tool preprocessing while tracking original offsets.

    Returns the preprocessed text and a mapping list of length
    `len(preprocessed) + 1` where entry `i` is the original-text index
    corresponding to preprocessed position `i`.
    """
    length_preserving = txt.replace("\xa0", " ")
    length_preserving = _remove_accents(length_preserving)
    length_preserving = (
        length_preserving.replace("”", '"')
        .replace("“", '"')
        .replace("〝", '"')
        .replace("〞", '"')
    )
    if len(length_preserving) != len(txt):
        raise AssertionError("length-preserving preprocessing changed string length")

    chars: list[str] = list(length_preserving)
    mapping: list[int] = list(range(len(chars) + 1))

    for old, new in _LENGTH_CHANGING_REPLACEMENTS:
        chars, mapping = _apply_replace_with_mapping(chars, mapping, old, new)

    return "".join(chars), mapping


def extract_quotations_for_texts(texts: list[str]) -> list[list[dict[str, Any]]]:
    """Extract quotations from a list of texts using the vendored QuoteExtractor.

    Used by quotation workers and live result queries.
    """
    extractor = _get_extractor()
    nlp = extractor.nlp
    results: list[list[dict[str, Any]]] = []

    for text in texts:
        if not text or not text.strip():
            results.append([])
            continue

        preprocessed, mapping = _preprocess_with_mapping(text)
        doc = nlp(preprocessed)
        raw_quotes = extractor.extract_quotes(doc)
        normalized = [
            _normalize_quote(q, idx, mapping) for idx, q in enumerate(raw_quotes)
        ]
        results.append(normalized)

    return results


def quotation_groups_for_dataframe(df: pl.DataFrame, column: str) -> pl.DataFrame:
    """Attach canonical grouped quotation records to a DataFrame."""
    texts = df.get_column(column).to_list()
    texts = [str(t) if t is not None else "" for t in texts]

    all_quotes = extract_quotations_for_texts(texts)

    return df.with_columns(
        pl.Series(
            QUOTATION_GROUP_COLUMN,
            all_quotes,
            dtype=QUOTATION_GROUP_DTYPE,
        )
    )
