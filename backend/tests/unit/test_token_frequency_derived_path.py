"""Token-frequency worker tests for raw text and token-stream inputs."""

from __future__ import annotations

import sys
from pathlib import Path
from types import ModuleType
from typing import Any, cast

import polars as pl
import pytest
from ldaca_wordflow.domain.workspace import Node, Workspace
from ldaca_wordflow.workers.input_snapshots import create_worker_input_snapshot
from ldaca_wordflow.workers.token_frequency import _compute_token_frequencies


def _stub_polars_text(monkeypatch) -> list[str | None]:
    """Stub polars_text so this test doesn't depend on the Rust extension."""
    fake = cast(Any, ModuleType("polars_text"))
    requested_models: list[str | None] = []

    def _token_frequencies(series: pl.Series, model: str) -> dict[str, int]:
        # Mimic the raw-text path: naive whitespace split for the test.
        requested_models.append(model)
        counter: dict[str, int] = {}
        for value in series.to_list():
            for token in (value or "").split():
                counter[token] = counter.get(token, 0) + 1
        return counter

    fake.token_frequencies = _token_frequencies
    fake.token_frequency_stats = lambda *_args, **_kwargs: pl.DataFrame()
    monkeypatch.setitem(sys.modules, "polars_text", fake)
    return requested_models


def test_worker_raw_text_path_unchanged_when_no_tokens(tmp_path, monkeypatch):
    requested_models = _stub_polars_text(monkeypatch)

    result = _compute_token_frequencies(
        workspace_id="ws-1",
        node_corpora={"node-1": ["alpha beta alpha", "alpha"]},
        node_display_names={"node-1": "EN Corpus"},
        artifact_dir=str(tmp_path / "output"),
        scratch_dir=str(tmp_path / "scratch"),
        artifact_prefix="token_freq_text",
        node_tokenizer_models={"node-1": "native:plain_words_en"},
    )

    assert result["state"] == "successful"
    assert requested_models == ["native:plain_words_en"]
    table_path = Path(result["tables"]["nodes"][0]["table"]["artifact"])
    counts = pl.read_ipc_stream(table_path).to_dicts()
    counts_map = {row["token"]: row["frequency"] for row in counts}
    assert counts_map == {"alpha": 3, "beta": 1}


def test_worker_mixes_token_stream_and_text_paths(tmp_path, monkeypatch):
    """Two-corpus comparison where one side uses a token stream."""
    requested_models = _stub_polars_text(monkeypatch)

    stream_path = tmp_path / "tokens-side-stream.parquet"
    pl.DataFrame({"token": ["beta", "gamma", "gamma"]}).write_parquet(stream_path)

    result = _compute_token_frequencies(
        workspace_id="ws-1",
        node_corpora={"text-side": ["alpha beta alpha"]},
        node_token_streams={"tokens-side": str(stream_path)},
        node_display_names={"text-side": "EN", "tokens-side": "ZH"},
        artifact_dir=str(tmp_path / "output"),
        scratch_dir=str(tmp_path / "scratch"),
        artifact_prefix="token_freq_mixed",
        node_tokenizer_models={"text-side": "native:plain_words_en"},
    )

    assert result["state"] == "successful"
    assert requested_models == ["native:plain_words_en"]
    node_paths = {
        table["node_id"]: Path(table["table"]["artifact"])
        for table in result["tables"]["nodes"]
    }
    text_counts = {
        row["token"]: row["frequency"]
        for row in pl.read_ipc_stream(node_paths["text-side"]).to_dicts()
    }
    tokens_counts = {
        row["token"]: row["frequency"]
        for row in pl.read_ipc_stream(node_paths["tokens-side"]).to_dicts()
    }
    assert text_counts == {"alpha": 2, "beta": 1}
    assert tokens_counts == {"beta": 1, "gamma": 2}


def test_worker_plain_request_uses_raw_text_even_if_node_preference_differs(
    tmp_path, monkeypatch
):
    requested_models = _stub_polars_text(monkeypatch)

    node = Node(
        data=pl.DataFrame({"document": ["alpha beta alpha", "beta"]}).lazy(),
        name="EN Corpus",
        id="node-1",
        tokenizer_model="lindera:jieba",
    )
    workspace = Workspace(name="tokens", workspace_id="ws-1")
    workspace.add_node(node)
    snapshot_dir = create_worker_input_snapshot(
        workspace_id=workspace.id,
        node_ids=["node-1"],
        workspace=workspace,
        workspace_data_dir=tmp_path,
        snapshot_dir=tmp_path / "snapshots" / "input",
        max_snapshot_bytes=1024 * 1024,
    )

    import ldaca_wordflow.analysis.token_cache as tokens_cache

    def _fail_tokenize(*_args, **_kwargs):
        raise AssertionError("plain words token frequency should not build tokens")

    monkeypatch.setattr(tokens_cache, "tokenize_lazyframe", _fail_tokenize)

    result = _compute_token_frequencies(
        workspace_id="ws-1",
        node_corpora={},
        node_display_names={},
        artifact_dir=str(tmp_path / "output"),
        scratch_dir=str(tmp_path / "scratch"),
        artifact_prefix="token_freq_plain_preference",
        input_snapshot_dir=str(snapshot_dir),
        node_ids=["node-1"],
        node_columns={"node-1": "document"},
        node_tokenizer_models={"node-1": "native:plain_words_en"},
    )

    assert result["state"] == "successful"
    assert requested_models == ["native:plain_words_en"]
    table_path = Path(result["tables"]["nodes"][0]["table"]["artifact"])
    counts = pl.read_ipc_stream(table_path).to_dicts()
    counts_map = {row["token"]: row["frequency"] for row in counts}
    assert counts_map == {"alpha": 2, "beta": 2}


def test_worker_raw_text_path_requires_tokenizer_model(tmp_path, monkeypatch):
    _stub_polars_text(monkeypatch)

    with pytest.raises(ValueError, match="node_tokenizer_models must include"):
        _compute_token_frequencies(
            workspace_id="ws-1",
            node_corpora={"node-1": ["alpha beta"]},
            node_display_names={"node-1": "EN Corpus"},
            artifact_dir=str(tmp_path / "output"),
            scratch_dir=str(tmp_path / "scratch"),
            artifact_prefix="token_freq_text",
        )


def test_worker_uses_node_token_streams_when_provided(tmp_path, monkeypatch):
    """The API endpoint spills one row per token to a
    parquet via ``sink_parquet``, then hands the path to the worker.
    Worker scans + group_by.len in Polars — no Python list materialisation.
    """
    _stub_polars_text(monkeypatch)

    # Simulate the spill the endpoint produces — one row per token, in
    # the ``token`` column, post-explode + post-null-filter.
    stream_path = tmp_path / "stream.parquet"
    pl.DataFrame(
        {"token": ["alpha", "beta", "alpha", "alpha", "gamma", "gamma"]}
    ).write_parquet(stream_path)

    result = _compute_token_frequencies(
        workspace_id="ws-1",
        node_corpora={},
        node_token_streams={"node-1": str(stream_path)},
        node_display_names={"node-1": "ZH Corpus"},
        artifact_dir=str(tmp_path / "output"),
        scratch_dir=str(tmp_path / "scratch"),
        artifact_prefix="token_freq_stream",
    )

    assert result["state"] == "successful"
    table_path = Path(result["tables"]["nodes"][0]["table"]["artifact"])
    counts = pl.read_ipc_stream(table_path).to_dicts()
    counts_map = {row["token"]: row["frequency"] for row in counts}
    assert counts_map == {"alpha": 3, "beta": 1, "gamma": 2}


def test_worker_token_stream_matches_manual_explode(tmp_path, monkeypatch):
    """The stream path matches the expected explode/group-by frequencies."""
    _stub_polars_text(monkeypatch)

    raw_token_lists = [
        ["alpha", "beta", "alpha", "gamma"],
        ["beta", "beta"],
        ["alpha"],
    ]

    # The polars baseline against an equivalent List[String] column.
    exploded_df = pl.DataFrame({"tokens": raw_token_lists}).explode("tokens")
    baseline_df = exploded_df.group_by("tokens").agg(pl.len().alias("frequency"))
    expected = {row["tokens"]: row["frequency"] for row in baseline_df.to_dicts()}
    stream_path = tmp_path / "stream.parquet"
    exploded_df.rename({"tokens": "token"}).select("token").write_parquet(stream_path)

    result = _compute_token_frequencies(
        workspace_id="ws-1",
        node_corpora={},
        node_token_streams={"node-1": str(stream_path)},
        node_display_names={"node-1": "Corpus"},
        artifact_dir=str(tmp_path / "output"),
        scratch_dir=str(tmp_path / "scratch"),
        artifact_prefix="token_freq_consistency",
    )

    table_path = Path(result["tables"]["nodes"][0]["table"]["artifact"])
    actual = {
        row["token"]: row["frequency"]
        for row in pl.read_ipc_stream(table_path).to_dicts()
    }
    assert actual == expected
