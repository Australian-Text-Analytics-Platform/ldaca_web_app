import polars as pl
from ldaca_wordflow.analysis.generated_columns import (
    CONCORDANCE_DATA_BLOCK_CREATION_COLUMNS,
)
from ldaca_wordflow.workers.concordance import run_concordance_run_all


def test_concordance_run_all_writes_complete_analysis_table_artifact(
    tmp_path, worker_snapshot
):
    progress_updates: list[tuple[float, str]] = []

    result = run_concordance_run_all(
        artifact_dir=str(tmp_path),
        input_snapshot_dir=str(
            worker_snapshot(
                node_id="11111111-1111-4111-8111-111111111111",
                columns={
                    "document": ["alpha beta alpha", "beta gamma"],
                    "metadata": ["A", "B"],
                },
            )
        ),
        parent_node_id="11111111-1111-4111-8111-111111111111",
        document_column="document",
        search_word="alpha",
        num_left_tokens=1,
        num_right_tokens=1,
        regex=False,
        whole_word=False,
        case_sensitive=False,
        progress_callback=lambda progress, message: progress_updates.append(
            (
                progress,
                message,
            )
        ),
    )

    assert result["state"] == "successful"
    source = result["source"]
    assert source["node_id"] == "11111111-1111-4111-8111-111111111111"
    assert source["document_column"] == "document"
    assert source["metadata_columns"] == ["metadata"]
    assert source["analysis_columns"] == [
        *CONCORDANCE_DATA_BLOCK_CREATION_COLUMNS,
        "CONC_extraction",
    ]
    assert source["table"]["table_id"] == "concordance-run-all"
    assert source["table"]["supports_density"] is True
    assert source["document_count"] == 1
    assert source["match_count"] == 2
    assert "data_block" not in source

    data_file = tmp_path / source["table"]["artifact"]
    assert data_file.exists()

    restored_df = pl.read_parquet(data_file)
    assert restored_df.height == 1
    assert restored_df["metadata"].to_list() == ["A"]
    assert "concordance" in restored_df.columns
    concordance_dtype = restored_df.schema["concordance"]
    assert isinstance(concordance_dtype, pl.List)
    concordance_struct = concordance_dtype.inner
    assert isinstance(concordance_struct, pl.Struct)
    concordance_fields = {
        field.name for field in concordance_struct.fields
    }
    assert set(CONCORDANCE_DATA_BLOCK_CREATION_COLUMNS).issubset(concordance_fields)
    assert "__wordflow_source_row_id" in restored_df.columns
    matches = restored_df.get_column("concordance").to_list()[0]
    assert len(matches) == 2
    assert [match["CONC_start_idx"] for match in matches] == [0, 11]
    assert progress_updates[0][1].startswith("Loading concordance")
    assert any(
        "Preparing text data" in message for _progress, message in progress_updates
    )
    assert progress_updates[-1] == (0.95, "Saving concordance Result...")


def test_concordance_run_all_retains_extraction_in_canonical_result(
    tmp_path, worker_snapshot
):
    result = run_concordance_run_all(
        artifact_dir=str(tmp_path),
        input_snapshot_dir=str(
            worker_snapshot(
                node_id="11111111-1111-4111-8111-111111111111",
                columns={"document": ["alpha beta gamma", "beta gamma alpha"]},
            )
        ),
        parent_node_id="11111111-1111-4111-8111-111111111111",
        document_column="document",
        search_word="alpha",
        num_left_tokens=1,
        num_right_tokens=1,
        regex=False,
        whole_word=False,
        case_sensitive=False,
    )
    assert result["state"] == "successful"
    source = result["source"]
    data_file = tmp_path / source["table"]["artifact"]
    restored_df = pl.read_parquet(data_file)
    concordance_dtype = restored_df.schema["concordance"]
    assert isinstance(concordance_dtype, pl.List)
    concordance_struct = concordance_dtype.inner
    assert isinstance(concordance_struct, pl.Struct)
    fields = concordance_struct.fields
    assert [field.name for field in fields] == [
        *CONCORDANCE_DATA_BLOCK_CREATION_COLUMNS,
        "CONC_extraction",
    ]
    # Sanity check the slice matches what Run All would have
    # produced for the same hits: "alpha beta" for the first row.
    assert restored_df.get_column("concordance").to_list()[0][0][
        "CONC_extraction"
    ] == "alpha beta"


def test_concordance_run_all_ignores_punctuation_but_preserves_raw_context(
    tmp_path, worker_snapshot
):
    result = run_concordance_run_all(
        artifact_dir=str(tmp_path),
        input_snapshot_dir=str(
            worker_snapshot(
                node_id="11111111-1111-4111-8111-111111111111",
                columns={
                    "document": [
                        "alpha one , , , target . . three omega",
                        "one target . three",
                    ]
                },
            )
        ),
        parent_node_id="11111111-1111-4111-8111-111111111111",
        document_column="document",
        search_word="target",
        num_left_tokens=2,
        num_right_tokens=2,
        regex=False,
        whole_word=False,
        case_sensitive=False,
        ignore_punctuation=True,
    )

    restored_df = pl.read_parquet(tmp_path / result["source"]["table"]["artifact"])
    first_hit = restored_df.get_column("concordance").to_list()[0][0]
    assert (
        first_hit["CONC_l1"],
        first_hit["CONC_r1"],
        first_hit["CONC_extraction"],
        first_hit["CONC_l1_freq"],
        first_hit["CONC_r1_freq"],
    ) == (
        "one",
        "three",
        "alpha one , , , target . . three omega",
        2,
        2,
    )
