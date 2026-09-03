import importlib
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from ldaca_wordflow.analysis import quotation_extractor as qe
from ldaca_wordflow._vendor.gender_gap_tracker.quote_extractor import QuoteExtractor


def test_extract_quotations_uses_the_model_bound_to_the_vendored_extractor(
    monkeypatch,
):
    class FakeNlp:
        def __call__(self, text: str):
            return SimpleNamespace(text=text)

    fake_nlp = FakeNlp()
    monkeypatch.setattr(qe, "_extractor", None)
    monkeypatch.setattr(qe, "_load_spacy_model", lambda: fake_nlp)
    monkeypatch.setattr(
        QuoteExtractor,
        "extract_quotes",
        lambda self, doc: [
            {
                "speaker": "Alex",
                "speaker_index": "(0,4)",
                "quote": doc.text,
                "quote_index": f"(0,{len(doc.text)})",
                "verb": "said",
                "verb_index": "(5,9)",
                "quote_type": "CSV",
                "quote_token_count": 2,
                "is_floating_quote": False,
            }
        ],
    )

    result = qe.extract_quotations_for_texts(["Alex said hello"])

    assert result[0][0]["quote"] == "Alex said hello"
    assert result[0][0]["speaker"] == "Alex"


def test_load_spacy_model_uses_an_installed_package(monkeypatch, tmp_path):
    calls: list[str] = []

    class FakeSpacyModule:
        def load(self, target: str):
            calls.append(target)
            return SimpleNamespace(name="installed-model")

    monkeypatch.setattr(qe, "_SPACY_MODEL_CACHE_ROOT", tmp_path)
    monkeypatch.setitem(__import__("sys").modules, "spacy", FakeSpacyModule())

    model = qe._load_spacy_model()

    assert model.name == "installed-model"
    assert calls == ["en_core_web_md"]


def test_load_spacy_model_prefers_the_platform_cache(monkeypatch, tmp_path):
    cached = tmp_path / qe._SPACY_MODEL
    cached.mkdir()
    (cached / "config.cfg").write_text("[nlp]\nlang = 'en'\n", encoding="utf-8")
    calls: list[object] = []

    class FakeSpacyModule:
        def load(self, target):
            calls.append(target)
            return SimpleNamespace(name="cached-model")

    monkeypatch.setattr(qe, "_SPACY_MODEL_CACHE_ROOT", tmp_path)
    monkeypatch.setitem(__import__("sys").modules, "spacy", FakeSpacyModule())

    model = qe._load_spacy_model()

    assert model.name == "cached-model"
    assert calls == [cached]


def test_load_spacy_model_downloads_only_when_the_package_is_missing(
    monkeypatch, tmp_path
):
    downloaded = tmp_path / "downloaded"
    downloaded.mkdir()
    (downloaded / "config.cfg").write_text("[nlp]\nlang = 'en'\n", encoding="utf-8")
    calls: list[object] = []

    class FakeSpacyModule:
        def load(self, target):
            calls.append(target)
            if target == qe._SPACY_MODEL:
                raise OSError(
                    "[E050] Can't find model 'en_core_web_md'. It doesn't seem "
                    "to be a Python package or a valid path."
                )
            return SimpleNamespace(name="downloaded-model")

    monkeypatch.setattr(qe, "_SPACY_MODEL_CACHE_ROOT", tmp_path / "cache")
    monkeypatch.setattr(qe, "_download_spacy_model", lambda: downloaded)
    monkeypatch.setitem(__import__("sys").modules, "spacy", FakeSpacyModule())

    model = qe._load_spacy_model()

    assert model.name == "downloaded-model"
    assert calls == [qe._SPACY_MODEL, downloaded]


def test_download_spacy_model_publishes_complete_model_data(monkeypatch, tmp_path):
    download_module = importlib.import_module("spacy.cli.download")
    monkeypatch.setattr(qe, "_SPACY_MODEL_CACHE_ROOT", tmp_path / "cache")
    monkeypatch.setattr(download_module, "get_compatibility", lambda: {})
    monkeypatch.setattr(download_module, "get_version", lambda _model, _data: "3.8.0")
    monkeypatch.setattr(
        download_module,
        "get_model_filename",
        lambda _model, _version, sdist: (
            "en_core_web_md-3.8.0/en_core_web_md-3.8.0.tar.gz"
            if sdist
            else "unexpected"
        ),
    )

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def raise_for_status(self):
            return None

        def iter_bytes(self):
            yield b"archive"

    class FakeArchive:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def extractall(self, destination: Path, *, filter: str):
            assert filter == "data"
            model = destination / "package" / "model"
            (model / "vocab").mkdir(parents=True)
            (model / "config.cfg").write_text("[nlp]\n", encoding="utf-8")
            (model / "meta.json").write_text("{}", encoding="utf-8")

    monkeypatch.setattr(qe.httpx, "stream", lambda *_args, **_kwargs: FakeResponse())
    monkeypatch.setattr(qe.tarfile, "open", lambda *_args, **_kwargs: FakeArchive())

    cached = qe._download_spacy_model()

    assert cached == tmp_path / "cache" / qe._SPACY_MODEL
    assert (cached / "config.cfg").is_file()
    assert not any(
        path.name.startswith(f".{qe._SPACY_MODEL}.") for path in cached.parent.iterdir()
    )


@pytest.mark.parametrize("failure_stage", ["download", "extraction"])
def test_download_or_extraction_failure_leaves_no_partial_cache(
    monkeypatch, tmp_path, failure_stage
):
    download_module = importlib.import_module("spacy.cli.download")
    cache_root = tmp_path / "cache"
    monkeypatch.setattr(qe, "_SPACY_MODEL_CACHE_ROOT", cache_root)
    monkeypatch.setattr(download_module, "get_compatibility", lambda: {})
    monkeypatch.setattr(download_module, "get_version", lambda _model, _data: "3.8.0")
    monkeypatch.setattr(
        download_module,
        "get_model_filename",
        lambda *_args, **_kwargs: "en_core_web_md-3.8.0.tar.gz",
    )

    class FailedResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def raise_for_status(self):
            if failure_stage == "download":
                raise httpx.HTTPError("download failed")

        def iter_bytes(self):
            yield b"archive"

    class FailedArchive:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def extractall(self, *_args, **_kwargs):
            raise qe.tarfile.ReadError("extraction failed")

    monkeypatch.setattr(
        qe.httpx,
        "stream",
        lambda *_args, **_kwargs: FailedResponse(),
    )
    monkeypatch.setattr(
        qe.tarfile,
        "open",
        lambda *_args, **_kwargs: FailedArchive(),
    )

    with pytest.raises((httpx.HTTPError, qe.tarfile.ReadError)):
        qe._download_spacy_model()

    assert list(cache_root.iterdir()) == []


def test_concurrent_cache_winner_is_reused(tmp_path):
    staged = tmp_path / "staged"
    staged.mkdir()
    (staged / "config.cfg").write_text("staged", encoding="utf-8")
    destination = tmp_path / "destination"
    destination.mkdir()
    (destination / "config.cfg").write_text("winner", encoding="utf-8")

    assert qe._publish_cached_spacy_model(staged, destination) == destination
    assert (destination / "config.cfg").read_text(encoding="utf-8") == "winner"


def _assert_mapping_roundtrips(original: str) -> None:
    preprocessed, mapping = qe._preprocess_with_mapping(original)
    assert len(mapping) == len(preprocessed) + 1
    assert mapping[0] == 0
    assert mapping[-1] == len(original)
    for i in range(len(mapping) - 1):
        assert 0 <= mapping[i] <= mapping[i + 1] <= len(original)


def test_preprocess_with_mapping_identity_for_plain_ascii():
    original = "Hello world."
    preprocessed, mapping = qe._preprocess_with_mapping(original)
    assert preprocessed == original
    assert mapping == list(range(len(original) + 1))


def test_preprocess_with_mapping_translates_indices_across_newline_expansion():
    original = 'Line one\nShe said "hi" loudly.'
    preprocessed, mapping = qe._preprocess_with_mapping(original)

    # Newline expands: "\n" -> ".\n "; no other length change in this string.
    assert preprocessed.count(".\n ") == 1
    assert len(preprocessed) == len(original) + 2

    target = "She said"
    preproc_start = preprocessed.index(target)
    preproc_end = preproc_start + len(target)
    orig_start, orig_end = qe._translate_span(preproc_start, preproc_end, mapping)
    assert original[orig_start:orig_end] == target

    _assert_mapping_roundtrips(original)


def test_preprocess_with_mapping_handles_double_space_collapse():
    original = "word  gap here."
    preprocessed, mapping = qe._preprocess_with_mapping(original)
    assert preprocessed == "word gap here."

    target = "gap here."
    preproc_start = preprocessed.index(target)
    preproc_end = preproc_start + len(target)
    orig_start, orig_end = qe._translate_span(preproc_start, preproc_end, mapping)
    assert original[orig_start:orig_end] == target

    _assert_mapping_roundtrips(original)


def test_preprocess_with_mapping_preserves_length_for_curly_quotes_and_accents():
    original = "Café said \u201chello\u201d today."
    preprocessed, mapping = qe._preprocess_with_mapping(original)
    assert len(preprocessed) == len(original)
    assert mapping == list(range(len(original) + 1))
    assert preprocessed.startswith("Cafe said ")
    assert '"hello"' in preprocessed


def test_accent_translation_handles_each_g_breve_and_macron_independently():
    original = "ğḡĞḠ café Şule"

    preprocessed, mapping = qe._preprocess_with_mapping(original)

    assert preprocessed == "ggGG cafe Sule"
    assert mapping == list(range(len(original) + 1))


def test_normalize_quote_translates_indices_to_original_offsets():
    original = "Line one\nShe said HI loudly."
    preprocessed, mapping = qe._preprocess_with_mapping(original)

    speaker = "She"
    verb = "said"
    quote = "HI"

    def span(needle: str) -> str:
        start = preprocessed.index(needle)
        return f"({start},{start + len(needle)})"

    raw = {
        "speaker": speaker,
        "speaker_index": span(speaker),
        "quote": quote,
        "quote_index": span(quote),
        "verb": verb,
        "verb_index": span(verb),
        "quote_type": "direct",
        "quote_token_count": 1,
        "is_floating_quote": False,
    }

    normalized = qe._normalize_quote(raw, 0, mapping)

    assert (
        original[normalized["speaker_start_idx"] : normalized["speaker_end_idx"]]
        == speaker
    )
    assert original[normalized["verb_start_idx"] : normalized["verb_end_idx"]] == verb
    assert (
        original[normalized["quote_start_idx"] : normalized["quote_end_idx"]] == quote
    )
