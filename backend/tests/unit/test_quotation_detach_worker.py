from pathlib import Path

import polars as pl
from ldaca_web_app_backend.core.worker_tasks_quotation import run_quotation_detach_task


def test_quotation_detach_task_writes_node_payload_without_internal_source_column(
    tmp_path,
    monkeypatch,
):
    def fake_quotation_via_polars_text(input_df: pl.DataFrame, source_column: str):
        assert source_column == "__quotation_source__"
        return pl.DataFrame({
            "__quotation_source__": input_df.get_column(source_column).to_list(),
            "document": input_df.get_column("document").to_list(),
            "speaker_label": ["narrator"],
            "QUOTE_speaker": ["Ada"],
            "QUOTE_speaker_start_idx": [0],
            "QUOTE_speaker_end_idx": [3],
            "QUOTE_quote": ["Hello"],
            "QUOTE_quote_start_idx": [5],
            "QUOTE_quote_end_idx": [10],
            "QUOTE_verb": ["said"],
            "QUOTE_verb_start_idx": [11],
            "QUOTE_verb_end_idx": [15],
            "QUOTE_quote_type": ["direct"],
            "QUOTE_quote_token_count": [1],
            "QUOTE_is_floating_quote": [False],
            "QUOTE_quote_row_idx": [0],
        })

    monkeypatch.setattr(
        "ldaca_web_app_backend.api.workspaces.analyses.quotation_core.quotation_via_polars_text",
        fake_quotation_via_polars_text,
    )

    result = run_quotation_detach_task(
        configure_worker_environment=lambda: None,
        workspace_dir=str(tmp_path),
        node_corpus=['Ada said "Hello"'],
        parent_node_id="parent-1",
        document_column="document",
        engine_config={},
        new_node_name="detached_quotation",
        include_document_column=True,
        extra_columns_data={"speaker_label": ["narrator"]},
    )

    assert result["state"] == "successful"
    payload = result["result"]["node_payload"]
    data_file = tmp_path / Path(payload["data_path"])
    assert data_file.exists()

    restored = pl.LazyFrame.deserialize(data_file.open("rb"), format="binary")
    assert restored.collect_schema().names() == [
        "document",
        "speaker_label",
        "QUOTE_speaker",
        "QUOTE_speaker_start_idx",
        "QUOTE_speaker_end_idx",
        "QUOTE_quote",
        "QUOTE_quote_start_idx",
        "QUOTE_quote_end_idx",
        "QUOTE_verb",
        "QUOTE_verb_start_idx",
        "QUOTE_verb_end_idx",
        "QUOTE_quote_type",
        "QUOTE_quote_token_count",
        "QUOTE_is_floating_quote",
        "QUOTE_quote_row_idx",
    ]
    assert "__quotation_source__" not in restored.collect_schema().names()

    assert result["result"]["output_columns"] == [
        "document",
        "speaker_label",
        "QUOTE_speaker",
        "QUOTE_speaker_start_idx",
        "QUOTE_speaker_end_idx",
        "QUOTE_quote",
        "QUOTE_quote_start_idx",
        "QUOTE_quote_end_idx",
        "QUOTE_verb",
        "QUOTE_verb_start_idx",
        "QUOTE_verb_end_idx",
        "QUOTE_quote_type",
        "QUOTE_quote_token_count",
        "QUOTE_is_floating_quote",
        "QUOTE_quote_row_idx",
    ]
