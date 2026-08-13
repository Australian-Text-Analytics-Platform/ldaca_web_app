from pathlib import Path
from types import ModuleType, SimpleNamespace

from ldaca_wordflow.analysis import quotation_extractor as qe
from ldaca_wordflow._vendor.gender_gap_tracker.quote_extractor import QuoteExtractor


def test_vendored_extractor_exposes_only_the_in_process_algorithm(tmp_path: Path):
    verbs = tmp_path / "verbs.txt"
    verbs.write_text("said\nreported\n", encoding="utf-8")
    nlp = object()

    extractor = QuoteExtractor(verbs, nlp)

    assert extractor.quote_verbs == ["said", "reported"]
    assert extractor.nlp is nlp
    assert not hasattr(extractor, "run")


def test_extract_quotations_uses_the_model_bound_to_the_vendored_extractor(
    monkeypatch,
):
    class FakeNlp:
        def __call__(self, text: str):
            return SimpleNamespace(text=text)

    fake_nlp = FakeNlp()
    monkeypatch.setattr(qe, "_nlp_model", None)
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


def test_load_spacy_model_downloads_to_cache_when_package_missing(
    monkeypatch, tmp_path
):
    cache_root = tmp_path / "spacy-cache"
    downloaded_model_dir = cache_root / "en_core_web_md"
    load_calls: list[object] = []

    class FakeSpacyModule:
        def load(self, target):
            load_calls.append(target)
            if target == qe._SPACY_MODEL:
                raise OSError(
                    "[E050] Can't find model 'en_core_web_md'. It doesn't seem "
                    "to be a Python package or a valid path to a data directory."
                )
            return SimpleNamespace(name="downloaded-model", target=target)

    def fake_download() -> Path:
        downloaded_model_dir.mkdir(parents=True, exist_ok=True)
        (downloaded_model_dir / "config.cfg").write_text(
            '[nlp]\nlang = "en"\n',
            encoding="utf-8",
        )
        return downloaded_model_dir

    monkeypatch.setattr(qe, "_SPACY_MODEL_CACHE_ROOT", cache_root)
    monkeypatch.setattr(qe, "_download_spacy_model_to_cache", fake_download)
    monkeypatch.setitem(__import__("sys").modules, "spacy", FakeSpacyModule())

    model = qe._load_spacy_model()

    assert model.name == "downloaded-model"
    assert load_calls == [qe._SPACY_MODEL, downloaded_model_dir]


def test_load_spacy_model_prefers_cached_directory(monkeypatch, tmp_path):
    cache_root = tmp_path / "spacy-cache"
    cached_model_dir = cache_root / "en_core_web_md"
    cached_model_dir.mkdir(parents=True, exist_ok=True)
    (cached_model_dir / "config.cfg").write_text(
        '[nlp]\nlang = "en"\n',
        encoding="utf-8",
    )
    load_calls: list[object] = []

    class FakeSpacyModule:
        def load(self, target):
            load_calls.append(target)
            return SimpleNamespace(name="cached-model", target=target)

    monkeypatch.setattr(qe, "_SPACY_MODEL_CACHE_ROOT", cache_root)
    monkeypatch.setitem(__import__("sys").modules, "spacy", FakeSpacyModule())

    model = qe._load_spacy_model()

    assert model.name == "cached-model"
    assert load_calls == [cached_model_dir]


def test_download_spacy_model_handles_nested_archive_filename(monkeypatch, tmp_path):
    cache_root = tmp_path / "spacy-cache"
    extracted_model_dir = tmp_path / "extracted-model"
    extracted_model_dir.mkdir(parents=True, exist_ok=True)
    (extracted_model_dir / "config.cfg").write_text(
        '[nlp]\nlang = "en"\n',
        encoding="utf-8",
    )
    (extracted_model_dir / "meta.json").write_text("{}", encoding="utf-8")
    (extracted_model_dir / "vocab").mkdir(exist_ok=True)

    spacy_module = ModuleType("spacy")
    about_module = ModuleType("spacy.about")
    cli_module = ModuleType("spacy.cli")
    download_module = ModuleType("spacy.cli.download")
    setattr(about_module, "__download_url__", "https://example.invalid/download")

    def fake_get_compatibility():
        return {qe._SPACY_MODEL: ["3.8.0"]}

    def fake_get_version(_model: str, _compatibility: dict):
        return "3.8.0"

    def fake_get_model_filename(_model: str, _version: str, sdist: bool = False):
        assert sdist is True
        return "en_core_web_md-3.8.0/en_core_web_md-3.8.0.tar.gz"

    setattr(download_module, "get_compatibility", fake_get_compatibility)
    setattr(download_module, "get_version", fake_get_version)
    setattr(download_module, "get_model_filename", fake_get_model_filename)
    setattr(cli_module, "download", download_module)
    setattr(spacy_module, "about", about_module)
    setattr(spacy_module, "cli", cli_module)

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def raise_for_status(self):
            return None

        def iter_bytes(self):
            yield b"fake-archive-bytes"

    class FakeTarFile:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def getmembers(self):
            return []

        def extractall(self, destination):
            return None

    monkeypatch.setattr(qe, "_SPACY_MODEL_CACHE_ROOT", cache_root)
    monkeypatch.setattr(qe, "_find_spacy_data_dir", lambda root: extracted_model_dir)
    monkeypatch.setattr(qe.httpx, "stream", lambda *args, **kwargs: FakeResponse())
    monkeypatch.setattr(qe.tarfile, "open", lambda *args, **kwargs: FakeTarFile())
    monkeypatch.setitem(__import__("sys").modules, "spacy", spacy_module)
    monkeypatch.setitem(__import__("sys").modules, "spacy.about", about_module)
    monkeypatch.setitem(__import__("sys").modules, "spacy.cli", cli_module)
    monkeypatch.setitem(
        __import__("sys").modules,
        "spacy.cli.download",
        download_module,
    )

    cache_dir = qe._download_spacy_model_to_cache()

    assert cache_dir == cache_root / qe._SPACY_MODEL
    assert (cache_dir / "config.cfg").exists()


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
