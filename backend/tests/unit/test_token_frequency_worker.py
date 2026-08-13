import sys
from types import ModuleType
from typing import Any, cast

import polars as pl
from ldaca_wordflow.workers.token_frequency import _compute_token_frequencies


def test_token_frequency_worker_emits_early_progress_updates(tmp_path, monkeypatch):
    progress_updates: list[tuple[float, str]] = []
    requested_models: list[str | None] = []

    fake_polars_text = cast(Any, ModuleType("polars_text"))

    def fake_token_frequencies(series, model):
        requested_models.append(model)
        return {"alpha": 3, "beta": 1}

    fake_polars_text.token_frequencies = fake_token_frequencies
    fake_polars_text.token_frequency_stats = lambda left, right: pl.DataFrame(
        {
            "token": ["alpha"],
            "freq_corpus_0": [3],
            "percent_corpus_0": [0.75],
            "expected_0": [2.5],
            "corpus_0_total": [4],
            "freq_corpus_1": [2],
            "percent_corpus_1": [0.5],
            "expected_1": [2.5],
            "corpus_1_total": [4],
            "log_likelihood_llv": [1.2],
            "percent_diff": [0.25],
            "bayes_factor_bic": [0.5],
            "effect_size_ell": [0.1],
            "relative_risk": [1.5],
            "log_ratio": [0.3],
            "odds_ratio": [1.2],
            "significance": ["*"],
        }
    )
    monkeypatch.setitem(sys.modules, "polars_text", fake_polars_text)

    result = _compute_token_frequencies(
        workspace_id="ws-1",
        node_corpora={
            "node-1": ["alpha beta alpha"],
            "node-2": ["alpha beta"],
        },
        node_display_names={"node-1": "Data Block 1", "node-2": "Data Block 2"},
        artifact_dir=str(tmp_path / "output"),
        scratch_dir=str(tmp_path / "scratch"),
        artifact_prefix="token_frequency_test",
        progress_callback=lambda progress, message: progress_updates.append(
            (
                progress,
                message,
            )
        ),
        node_tokenizer_models={
            "node-1": "lindera:jieba",
            "node-2": "lindera:jieba",
        },
    )

    assert result["state"] == "successful"
    assert requested_models == ["lindera:jieba", "lindera:jieba"]
    assert progress_updates[0][1].startswith("Loading token frequency")
    assert any(
        "Preparing text data" in message for _progress, message in progress_updates
    )
    assert progress_updates[-1] == (0.85, "Writing token-frequency results...")
    assert all(0.0 <= fraction < 1.0 for fraction, _message in progress_updates)

    statistics_artifact = result["tables"]["statistics"]["artifact"]
    statistics = pl.read_ipc_stream(statistics_artifact)
    assert {
        "freq_reference",
        "percent_reference",
        "expected_reference",
        "reference_total",
        "freq_study",
        "percent_study",
        "expected_study",
        "study_total",
    }.issubset(statistics.columns)
    assert {
        "freq_corpus_0",
        "percent_corpus_0",
        "expected_0",
        "corpus_0_total",
        "freq_corpus_1",
        "percent_corpus_1",
        "expected_1",
        "corpus_1_total",
    }.isdisjoint(statistics.columns)


def test_token_frequency_worker_uses_per_node_tokenizer_models(tmp_path, monkeypatch):
    requested_models: list[str | None] = []

    fake_polars_text = cast(Any, ModuleType("polars_text"))

    def fake_token_frequencies(series, model):
        requested_models.append(model)
        return {str(model): 1}

    fake_polars_text.token_frequencies = fake_token_frequencies
    fake_polars_text.token_frequency_stats = lambda left, right: pl.DataFrame(
        {
            "token": ["alpha"],
            "freq_corpus_0": [1],
            "percent_corpus_0": [1.0],
            "freq_corpus_1": [1],
            "percent_corpus_1": [1.0],
            "log_likelihood_llv": [0.0],
            "percent_diff": [0.0],
            "bayes_factor_bic": [0.0],
            "effect_size_ell": [0.0],
            "relative_risk": [1.0],
            "log_ratio": [0.0],
            "odds_ratio": [1.0],
            "significance": [""],
        }
    )
    monkeypatch.setitem(sys.modules, "polars_text", fake_polars_text)

    result = _compute_token_frequencies(
        workspace_id="ws-1",
        node_corpora={
            "node-en": ["alpha beta"],
            "node-ja": ["吾輩は猫である"],
        },
        node_display_names={"node-en": "English", "node-ja": "Japanese"},
        artifact_dir=str(tmp_path / "output"),
        scratch_dir=str(tmp_path / "scratch"),
        artifact_prefix="token_frequency_models",
        node_tokenizer_models={
            "node-en": "native:plain_words_en",
            "node-ja": "lindera:ja-ipadic",
        },
    )

    assert requested_models == ["native:plain_words_en", "lindera:ja-ipadic"]
    assert "analysis_params" not in result
    assert [item["node_name"] for item in result["tables"]["nodes"]] == [
        "English",
        "Japanese",
    ]
