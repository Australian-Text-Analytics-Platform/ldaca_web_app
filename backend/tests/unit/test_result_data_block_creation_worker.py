"""Concordance Match and Document Data Block Creation worker tests."""

from __future__ import annotations

import uuid
from pathlib import Path

import polars as pl

from ldaca_wordflow.workers.result_data_block_creation import run_result_data_block_creation


def test_document_data_block_creation_keeps_source_rows_and_joins_filtered_extractions(
    tmp_path: Path,
) -> None:
    source_id = uuid.uuid4()
    source_path = tmp_path / "source.parquet"
    output_dir = tmp_path / "output"
    output_dir.mkdir()
    pl.DataFrame(
        {
            "__wordflow_source_row_id": [1, 2],
            "text": ["same document", "same document"],
            "author": ["first", "second"],
            "concordance": [
                [
                    {
                        "CONC_matched_text": "same",
                        "CONC_start_idx": 0,
                        "CONC_extraction": " same   document ",
                    },
                    {
                        "CONC_matched_text": "document",
                        "CONC_start_idx": 5,
                        "CONC_extraction": "second\n window",
                    },
                ],
                [
                    {
                        "CONC_matched_text": "same",
                        "CONC_start_idx": 0,
                        "CONC_extraction": " other row ",
                    }
                ],
            ],
        }
    ).write_parquet(source_path)

    result = run_result_data_block_creation(
        artifact_dir=str(output_dir),
        request_payload={
            "kind": "concordance_document_data_block_creation",
            "sources": [
                {
                    "source_node_id": str(source_id),
                    "selected_metadata_columns": ["author"],
                    "new_node_name": "Documents",
                    "excluded_matched_texts": [],
                    "bin_count": None,
                    "selected_bins": None,
                }
            ],
        },
        result_paths={str(source_id): str(source_path)},
        document_columns={str(source_id): "text"},
        source_colors={str(source_id): "#123456"},
    )
    output = result["outputs"][0]["data"]
    frame = pl.read_parquet(output_dir / output["parquet_path"])

    assert frame.columns == ["text", "CONC_extraction", "author"]
    assert frame.height == 2
    assert frame["author"].to_list() == ["first", "second"]
    assert frame["CONC_extraction"].to_list() == [
        "same document\nsecond window",
        "other row",
    ]


def test_document_data_block_creation_allows_schema_only_output(tmp_path: Path) -> None:
    source_id = uuid.uuid4()
    source_path = tmp_path / "source.parquet"
    output_dir = tmp_path / "output"
    output_dir.mkdir()
    pl.DataFrame(
        {
            "__wordflow_source_row_id": [1],
            "text": ["alpha"],
            "concordance": [
                [
                    {
                        "CONC_matched_text": "alpha",
                        "CONC_start_idx": 0,
                        "CONC_extraction": "alpha",
                    }
                ]
            ],
        }
    ).write_parquet(source_path)

    result = run_result_data_block_creation(
        artifact_dir=str(output_dir),
        request_payload={
            "kind": "concordance_document_data_block_creation",
            "sources": [
                {
                    "source_node_id": str(source_id),
                    "selected_metadata_columns": [],
                    "new_node_name": "Empty documents",
                    "excluded_matched_texts": ["alpha"],
                    "bin_count": None,
                    "selected_bins": None,
                }
            ],
        },
        result_paths={str(source_id): str(source_path)},
        document_columns={str(source_id): "text"},
        source_colors={str(source_id): None},
    )
    output = result["outputs"][0]["data"]
    frame = pl.read_parquet(output_dir / output["parquet_path"])

    assert frame.columns == ["text", "CONC_extraction"]
    assert frame.height == 0
