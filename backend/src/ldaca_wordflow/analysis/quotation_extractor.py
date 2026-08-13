"""Adapter from the vendored quotation extractor into Polars analysis.

Wraps the GenderGapTracker QuoteExtractor to provide a Polars-compatible
interface matching the output format expected by quotation_core.py.

Used by local quotation Analysis execution and focused backend tests.

Flow: normalize source text, run local or remote quotation extraction, preserve
    source-row mappings, and return grouped quotation artifacts for later
    materialization.
"""

from __future__ import annotations

import re
import shutil
import tarfile
import tempfile
from pathlib import Path
from typing import Any

import httpx
import polars as pl

_ENGLISH_DIR = Path(__file__).resolve().parents[1] / "_vendor" / "gender_gap_tracker"
_QUOTE_VERBS_PATH = _ENGLISH_DIR / "rules" / "quote_verb_list.txt"
_SPACY_MODEL = "en_core_web_md"
_SPACY_MODEL_CACHE_ROOT = Path.home() / ".cache" / "ldaca_wordflow" / "spacy"

_nlp_model = None
_extractor = None

QUOTATION_GROUP_COLUMN = "quotation"


def _get_cached_spacy_model_dir() -> Path:
    """Return the local cache directory for the quotation spaCy model."""
    return _SPACY_MODEL_CACHE_ROOT / _SPACY_MODEL


def _is_missing_spacy_model_error(exc: OSError) -> bool:
    """Return true when spaCy failed because the model package is absent."""
    return "[E050]" in str(exc) and _SPACY_MODEL in str(exc)


def _find_spacy_data_dir(root: Path) -> Path:
    """Locate the extracted pipeline data directory inside a model archive."""
    candidates = sorted(
        path
        for path in root.rglob("config.cfg")
        if (path.parent / "meta.json").exists()
    )
    for config_path in candidates:
        model_dir = config_path.parent
        if (model_dir / "vocab").exists() or (model_dir / "tokenizer").exists():
            return model_dir
    raise FileNotFoundError(
        f"Could not locate extracted spaCy data directory under {root}"
    )


def _safe_extract_tar(archive: tarfile.TarFile, destination: Path) -> None:
    """Extract a tar archive while rejecting paths outside the destination."""
    destination = destination.resolve()
    for member in archive.getmembers():
        member_path = (destination / member.name).resolve()
        if not member_path.is_relative_to(destination):
            raise ValueError(f"Unsafe path in archive: {member.name}")
    archive.extractall(destination)


def _download_spacy_model_to_cache() -> Path:
    """Download a compatible spaCy pipeline archive into the local cache."""
    from spacy import about
    from spacy.cli.download import get_compatibility, get_model_filename, get_version

    cache_dir = _get_cached_spacy_model_dir()
    if (cache_dir / "config.cfg").exists():
        return cache_dir

    compatibility = get_compatibility()
    version = get_version(_SPACY_MODEL, compatibility)
    archive_name = get_model_filename(_SPACY_MODEL, version, sdist=True)
    archive_url = f"{about.__download_url__.rstrip('/')}/{archive_name}"

    cache_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ldaca-spacy-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        archive_path = temp_dir / Path(archive_name).name

        with httpx.stream(
            "GET",
            archive_url,
            follow_redirects=True,
            timeout=120.0,
        ) as response:
            response.raise_for_status()
            with archive_path.open("wb") as archive_file:
                for chunk in response.iter_bytes():
                    archive_file.write(chunk)

        extract_root = temp_dir / "extract"
        extract_root.mkdir(parents=True, exist_ok=True)
        with tarfile.open(archive_path, "r:gz") as archive:
            _safe_extract_tar(archive, extract_root)

        extracted_model_dir = _find_spacy_data_dir(extract_root)
        staged_dir = temp_dir / _SPACY_MODEL
        shutil.copytree(extracted_model_dir, staged_dir)

        if cache_dir.exists():
            return cache_dir

        shutil.move(str(staged_dir), str(cache_dir))

    return cache_dir


def _load_spacy_model():
    """Load the quotation spaCy model from cache or download it on first use."""
    import spacy

    cached_dir = _get_cached_spacy_model_dir()
    if (cached_dir / "config.cfg").exists():
        return spacy.load(cached_dir)

    try:
        return spacy.load(_SPACY_MODEL)
    except OSError as exc:
        if not _is_missing_spacy_model_error(exc):
            raise

    cached_dir = _download_spacy_model_to_cache()
    return spacy.load(cached_dir)


def _get_extractor():
    """Lazy-load spaCy model and QuoteExtractor (expensive, cached)."""
    global _nlp_model, _extractor

    if _extractor is not None:
        return _extractor

    from .._vendor.gender_gap_tracker.quote_extractor import QuoteExtractor

    _nlp_model = _load_spacy_model()
    _extractor = QuoteExtractor(_QUOTE_VERBS_PATH, _nlp_model)
    return _extractor


_INDEX_RE = re.compile(r"\((\d+),(\d+)\)")


def _remove_accents(txt: str) -> str:
    """Mirror the quotation-tool accent normalization used before parsing."""
    txt = re.sub("[àáâãäåā]", "a", txt)
    txt = re.sub("[èéêëē]", "e", txt)
    txt = re.sub("[ìíîïıī]", "i", txt)
    txt = re.sub("[òóôõöō]", "o", txt)
    txt = re.sub("[ùúûüū]", "u", txt)
    txt = re.sub("[ýÿȳ]", "y", txt)
    txt = re.sub("ç", "c", txt)
    txt = re.sub("ğḡ", "g", txt)
    txt = re.sub("ñ", "n", txt)
    txt = re.sub("ş", "s", txt)
    txt = re.sub("[ÀÁÂÃÄÅĀ]", "A", txt)
    txt = re.sub("[ÈÉÊËĒ]", "E", txt)
    txt = re.sub("[ÌÍÎÏİĪ]", "I", txt)
    txt = re.sub("[ÒÓÔÕÖŌ]", "O", txt)
    txt = re.sub("[ÙÚÛÜŪ]", "U", txt)
    txt = re.sub("[ÝŸȲ]", "Y", txt)
    txt = re.sub("Ç", "C", txt)
    txt = re.sub("ĞḠ", "G", txt)
    txt = re.sub("Ñ", "N", txt)
    txt = re.sub("Ş", "S", txt)
    return txt


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


def _preprocess_text(txt: str) -> str:
    """Apply the subset of quotation-tool preprocessing needed for extraction."""
    preprocessed, _ = _preprocess_with_mapping(txt)
    return preprocessed


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

    struct_dtype = pl.Struct(
        {
            "speaker": pl.Utf8,
            "speaker_start_idx": pl.Int64,
            "speaker_end_idx": pl.Int64,
            "quote": pl.Utf8,
            "quote_start_idx": pl.Int64,
            "quote_end_idx": pl.Int64,
            "verb": pl.Utf8,
            "verb_start_idx": pl.Int64,
            "verb_end_idx": pl.Int64,
            "quote_type": pl.Utf8,
            "quote_token_count": pl.Int64,
            "is_floating_quote": pl.Boolean,
            "quote_row_idx": pl.Int64,
        }
    )

    return df.with_columns(
        pl.Series(
            QUOTATION_GROUP_COLUMN,
            all_quotes,
            dtype=pl.List(struct_dtype),
        )
    )
