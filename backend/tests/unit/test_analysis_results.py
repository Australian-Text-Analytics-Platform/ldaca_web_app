"""Typed Analysis Result projection tests."""

from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Literal, cast
import uuid

import polars as pl
import pytest
from pydantic import TypeAdapter, ValidationError

from ldaca_wordflow.models.analysis_results import (
    AnalysisResultQuery,
    ConcordanceDocumentProjectionQuery,
    QuotationPreviewQuery,
    TopicModelingResultQuery,
    TopicModelingStoredResult,
)
from ldaca_wordflow.services.analysis_results import (
    _concordance_density,
    _concordance_document_projection_page,
    _projected_artifact_page,
    _projected_artifact_schema,
    _query_topics as _query_topics_impl,
    _sort_and_page,
)
from ldaca_wordflow.services.topic_projection_cache import TopicProjectionBasisCache
from ldaca_wordflow.shared.errors import (
    AnalysisCorruptError,
    ArtifactGoneError,
    InvalidClusterCountError,
    InvalidInputError,
    InvalidTopicTopNError,
)
from ldaca_wordflow.shared.json_data import JsonData

_TEST_WORKSPACE_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
_TEST_ANALYSIS_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")


def _query_topics(
    stored: TopicModelingStoredResult,
    query: TopicModelingResultQuery,
    context_path: Path | None,
    projection_cache: TopicProjectionBasisCache | None = None,
) -> dict[str, JsonData]:
    return _query_topics_impl(
        stored,
        query,
        context_path,
        projection_cache,
        "test-user",
        _TEST_WORKSPACE_ID,
        _TEST_ANALYSIS_ID,
    )


def test_quotation_preview_query_contains_only_page_and_sort_controls() -> None:
    with pytest.raises(ValidationError):
        QuotationPreviewQuery.model_validate({"context_length": 12})


def test_generic_json_result_query_rejects_quotation() -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(AnalysisResultQuery).validate_python({"kind": "quotation"})


def _topic_stored_result() -> TopicModelingStoredResult:
    source_id = uuid.uuid4()
    return TopicModelingStoredResult.model_validate(
        {
            "topics": [
                {
                    "id": topic_id,
                    "representative_words": [
                        {"word": f"word-{topic_id}", "occurrence_count": 1}
                    ],
                    "size": [1],
                    "total_size": 1,
                    "x": float(topic_id),
                    "y": 0.0,
                }
                for topic_id in range(4)
            ],
            "corpus_sizes": [4],
            "segment_count": 4,
            "sources": [
                {
                    "node_id": source_id,
                    "node_name": "Source",
                    "text_column": "text",
                    "original_columns": ["text"],
                }
            ],
            "clustering": {
                "cluster_count": 4,
                "min_cluster_count": 2,
                "max_cluster_count": 4,
                "default_cluster_count": 4,
                "adjustable": True,
            },
            "topic_inclusion": {
                "top_n_topics": 2,
                "min_top_n_topics": 1,
                "max_top_n_topics": 4,
                "default_top_n_topics": 2,
                "adjustable": True,
            },
            "projection_context": {
                "version": 2,
                "artifact": {
                    "name": "topic_projection_context",
                    "media_type": "application/vnd.ldaca.topic-projection-context",
                },
                "source_row_indices": [[0, 1, 2, 3]],
            },
        }
    )


def test_natural_topic_query_is_side_effect_free_and_hides_private_context() -> None:
    stored = _topic_stored_result()
    before = stored.model_dump(mode="json")

    payload = _query_topics(
        stored,
        TopicModelingResultQuery(),
        None,
    )

    assert "projection_context" not in payload
    clustering = cast(dict[str, Any], payload["clustering"])
    topics = cast(list[dict[str, Any]], payload["topics"])
    assert clustering["cluster_count"] == 4
    assert [row["id"] for row in topics] == [0, 1, 2, 3]
    assert "pagination" not in payload
    assert stored.model_dump(mode="json") == before


@pytest.mark.parametrize("field", ["page", "page_size"])
def test_topic_query_rejects_pagination(field: str) -> None:
    with pytest.raises(ValidationError):
        TopicModelingResultQuery.model_validate({field: 1})


def test_explicit_natural_topic_query_reuses_stored_projection(tmp_path, monkeypatch) -> None:
    context_path = tmp_path / "context.msgpack.zst"
    context_path.write_bytes(b"context")
    calls: list[int] = []

    def fake_project(**kwargs):
        calls.append(kwargs["cluster_count"])
        return {
            "topics": [
                {
                    "id": topic_id,
                    "representative_words": [
                        {"word": f"word-{topic_id}", "occurrence_count": 1}
                    ],
                    "x": float(topic_id),
                    "y": 0.0,
                }
                for topic_id in range(4)
            ],
            "activations": [[0, topic_id, 1, 1] for topic_id in range(4)],
            "has_outlier": False,
        }

    monkeypatch.setattr(
        "ldaca_wordflow.services.analysis_results.project_rust_topic_projection_basis",
        fake_project,
    )

    payload = _query_topics(
        _topic_stored_result(),
        TopicModelingResultQuery(cluster_count=4),
        context_path,
    )

    assert calls == []
    assert cast(dict[str, Any], payload["clustering"])["cluster_count"] == 4


def test_changing_only_top_n_reuses_the_projection_basis(tmp_path, monkeypatch) -> None:
    context_path = tmp_path / "context.msgpack.zst"
    context_path.write_bytes(b"context")
    calls = 0

    def fake_project(**_kwargs):
        nonlocal calls
        calls += 1
        return {
            "topics": [
                {
                    "id": topic_id,
                    "representative_words": [
                        {"word": f"word-{topic_id}", "occurrence_count": 1}
                    ],
                    "x": float(topic_id),
                    "y": 0.0,
                }
                for topic_id in range(4)
            ],
            "activations": [[0, 0, 1, 4], [0, 1, 2, 4], [0, 2, 2, 4]],
            "has_outlier": False,
        }

    monkeypatch.setattr(
        "ldaca_wordflow.services.analysis_results.project_rust_topic_projection_basis",
        fake_project,
    )
    cache = TopicProjectionBasisCache(max_entries=16, max_bytes=1_000_000)

    first = _query_topics(
        _topic_stored_result(),
        TopicModelingResultQuery(top_n_topics=1),
        context_path,
        cache,
    )
    tied = _query_topics(
        _topic_stored_result(),
        TopicModelingResultQuery(top_n_topics=3),
        context_path,
        cache,
    )

    assert calls == 1
    first_topics = cast(list[dict[str, Any]], first["topics"])
    tied_topics = cast(list[dict[str, Any]], tied["topics"])
    assert [row["size"] for row in first_topics] == [[4], [0], [0], [0]]
    assert [row["size"] for row in tied_topics] == [[4], [4], [4], [0]]


def test_topic_query_rejects_count_with_current_bounds() -> None:
    with pytest.raises(InvalidClusterCountError) as exc_info:
        _query_topics(
            _topic_stored_result(),
            TopicModelingResultQuery(cluster_count=1),
            None,
        )

    assert exc_info.value.details == {
        "min_cluster_count": 2,
        "max_cluster_count": 4,
        "default_cluster_count": 4,
    }


def test_topic_query_rejects_top_n_with_current_bounds() -> None:
    with pytest.raises(InvalidTopicTopNError) as exc_info:
        _query_topics(
            _topic_stored_result(),
            TopicModelingResultQuery(top_n_topics=5),
            None,
        )

    assert exc_info.value.details == {
        "min_top_n_topics": 1,
        "max_top_n_topics": 4,
        "default_top_n_topics": 2,
        "cluster_count": 4,
    }


def test_topic_projection_requires_declared_context_file() -> None:
    with pytest.raises(ArtifactGoneError):
        _query_topics(
            _topic_stored_result(),
            TopicModelingResultQuery(cluster_count=2),
            None,
        )


def test_topic_projection_marks_invalid_context_as_analysis_corrupt(
    tmp_path, monkeypatch
) -> None:
    context_path = tmp_path / "context.msgpack.zst"
    context_path.write_bytes(b"invalid")
    monkeypatch.setattr(
        "ldaca_wordflow.services.analysis_results.project_rust_topic_projection_basis",
        lambda **_kwargs: (_ for _ in ()).throw(ValueError("invalid context")),
    )

    with pytest.raises(AnalysisCorruptError):
        _query_topics(
            _topic_stored_result(),
            TopicModelingResultQuery(cluster_count=2),
            context_path,
        )


def test_topic_projection_filters_projected_topics(tmp_path, monkeypatch) -> None:
    context_path = tmp_path / "context.msgpack.zst"
    context_path.write_bytes(b"context")

    def fake_project(**_kwargs):
        return {
            "topics": [
                {
                    "id": topic_id,
                    "representative_words": [
                        {"word": f"merged-{topic_id}", "occurrence_count": 2}
                    ],
                    "x": float(topic_id),
                    "y": 0.0,
                }
                for topic_id in range(2)
            ],
            "activations": [[0, 0, 1, 2], [0, 1, 1, 2]],
            "has_outlier": False,
        }

    monkeypatch.setattr(
        "ldaca_wordflow.services.analysis_results.project_rust_topic_projection_basis",
        fake_project,
    )
    payload = _query_topics(
        _topic_stored_result(),
        TopicModelingResultQuery(cluster_count=2, topic_ids=[1]),
        context_path,
    )

    clustering = cast(dict[str, Any], payload["clustering"])
    topics = cast(list[dict[str, Any]], payload["topics"])
    assert clustering["cluster_count"] == 2
    assert [row["id"] for row in topics] == [1]
    assert "pagination" not in payload
    assert topics[0]["size"] == [2]


@pytest.mark.parametrize(
    ("descending", "expected"),
    [
        (False, [2, 10, None]),
        (True, [10, 2, None]),
    ],
)
def test_result_sort_preserves_numeric_order_and_keeps_nulls_last(
    descending: bool,
    expected: list[int | None],
) -> None:
    rows: list[dict[str, JsonData]] = [
        {"value": 10},
        {"value": None},
        {"value": 2},
    ]

    page, _pagination = _sort_and_page(
        rows,
        page=1,
        page_size=10,
        sort_by="value",
        descending=descending,
        columns={"value"},
    )

    assert [row["value"] for row in page] == expected


def test_result_sort_rejects_unknown_columns() -> None:
    with pytest.raises(InvalidInputError):
        _sort_and_page(
            [{"value": 1}],
            page=1,
            page_size=10,
            sort_by="missing",
            descending=False,
            columns={"value"},
        )


def test_concordance_result_supports_document_and_match_pages(tmp_path) -> None:
    path = tmp_path / "concordance.parquet"
    pl.DataFrame(
        {
            "__wordflow_source_row_id": [2, 7],
            "text": ["alpha beta alpha", "beta alpha"],
            "group": ["a", "b"],
            "concordance": [
                [
                    {"CONC_matched_text": "alpha", "CONC_start_idx": 0},
                    {"CONC_matched_text": "alpha", "CONC_start_idx": 11},
                ],
                [{"CONC_matched_text": "alpha", "CONC_start_idx": 5}],
            ],
        }
    ).write_parquet(path)

    documents = pl.read_ipc_stream(
        BytesIO(
            _projected_artifact_page(
                path,
                "concordance_run_all",
                "documents",
                "text",
                ["group"],
                ["CONC_matched_text", "CONC_start_idx"],
                1,
                1,
                None,
                False,
            ).content
        )
    )
    matches = pl.read_ipc_stream(
        BytesIO(
            _projected_artifact_page(
                path,
                "concordance_run_all",
                "matches",
                "text",
                ["group"],
                ["CONC_matched_text", "CONC_start_idx"],
                1,
                2,
                None,
                False,
            ).content
        )
    )
    match_schema = pl.read_ipc_stream(
        BytesIO(
            _projected_artifact_schema(
                path, "concordance_run_all", "matches"
            )
        )
    )

    assert documents.height == 1
    assert documents["concordance"].list.len().to_list() == [2]
    assert matches["CONC_start_idx"].to_list() == [0, 11]
    assert "concordance" not in match_schema.columns


def test_quotation_result_supports_document_and_match_pages(tmp_path) -> None:
    path = tmp_path / "quotation.parquet"
    pl.DataFrame(
        {
            "__wordflow_source_row_id": [3],
            "text": ["Alice said hello and goodbye."],
            "group": ["a"],
            "quotation": [[
                {"quote": "hello", "quote_row_idx": 0},
                {"quote": "goodbye", "quote_row_idx": 1},
            ]],
        }
    ).write_parquet(path)

    documents = pl.read_ipc_stream(
        BytesIO(
            _projected_artifact_page(
                path,
                "quotation_run_all",
                "documents",
                "text",
                ["group"],
                ["QUOTE_quote", "QUOTE_quote_row_idx"],
                1,
                10,
                None,
                False,
            ).content
        )
    )
    matches = pl.read_ipc_stream(
        BytesIO(
            _projected_artifact_page(
                path,
                "quotation_run_all",
                "matches",
                "text",
                ["group"],
                ["QUOTE_quote", "QUOTE_quote_row_idx"],
                1,
                10,
                None,
                False,
            ).content
        )
    )

    assert documents["quotation"].list.len().to_list() == [2]
    assert matches["QUOTE_quote"].to_list() == ["hello", "goodbye"]
    assert matches["QUOTE_quote_row_idx"].to_list() == [0, 1]


def _concordance_sort_artifact(tmp_path):
    """Build a materialized match artifact used by Review sort-contract tests."""

    path = tmp_path / "concordance.parquet"
    pl.DataFrame(
        {
            "__wordflow_source_row_id": [3, 2, 1, 0],
            "text": ["doc 3", "doc 2", "doc 1", "doc 0"],
            "group": [2, 1, 2, 1],
            "reviewed": [True, False, True, False],
            "published": [
                datetime(2026, 1, 4),
                datetime(2026, 1, 3),
                datetime(2026, 1, 2),
                datetime(2026, 1, 1),
            ],
            "day": [date(2026, 1, 4), date(2026, 1, 3), date(2026, 1, 2), None],
            "nested_list": [[3], [2], [1], [0]],
            "nested_struct": [{"value": 3}, {"value": 2}, {"value": 1}, {"value": 0}],
            "concordance": [
                [
                    {
                        "CONC_matched_text": "the",
                        "CONC_start_idx": 30,
                        "CONC_l1": "the",
                        "CONC_r1": "z",
                        "CONC_l1_freq": 4,
                        "CONC_r1_freq": 1,
                    }
                ],
                [
                    {
                        "CONC_matched_text": "apple",
                        "CONC_start_idx": 20,
                        "CONC_l1": "Zebra",
                        "CONC_r1": "A",
                        "CONC_l1_freq": 3,
                        "CONC_r1_freq": 2,
                    }
                ],
                [
                    {
                        "CONC_matched_text": "Zebra",
                        "CONC_start_idx": 10,
                        "CONC_l1": "apple",
                        "CONC_r1": "b",
                        "CONC_l1_freq": 2,
                        "CONC_r1_freq": 3,
                    }
                ],
                [
                    {
                        "CONC_matched_text": "The",
                        "CONC_start_idx": 0,
                        "CONC_l1": "The",
                        "CONC_r1": "M",
                        "CONC_l1_freq": 1,
                        "CONC_r1_freq": 4,
                    }
                ],
            ],
        }
    ).write_parquet(path)
    return path


CONCORDANCE_SORT_ANALYSIS_COLUMNS = [
    "CONC_matched_text",
    "CONC_start_idx",
    "CONC_l1",
    "CONC_r1",
    "CONC_l1_freq",
    "CONC_r1_freq",
]


def _read_projected_sort(
    path, sort_by: str | None, descending: bool = False
) -> pl.DataFrame:
    """Read a complete Concordance match page for one requested Review sort."""

    page = _projected_artifact_page(
        path,
        "concordance_run_all",
        "matches",
        "text",
        ["group", "reviewed", "published", "day", "nested_list", "nested_struct"],
        CONCORDANCE_SORT_ANALYSIS_COLUMNS,
        1,
        10,
        sort_by,
        descending,
    )
    return pl.read_ipc_stream(BytesIO(page.content))


@pytest.mark.parametrize(
    ("sort_by", "descending", "expected"),
    [
        ("CONC_l1", False, ["The", "Zebra", "apple", "the"]),
        ("CONC_l1", True, ["the", "apple", "Zebra", "The"]),
        ("CONC_r1", False, ["A", "M", "b", "z"]),
        ("CONC_matched_text", False, ["The", "Zebra", "apple", "the"]),
        ("CONC_l1_freq", True, [4, 3, 2, 1]),
        ("CONC_r1_freq", False, [1, 2, 3, 4]),
        ("CONC_start_idx", False, [0, 10, 20, 30]),
        ("text", False, ["doc 0", "doc 1", "doc 2", "doc 3"]),
        ("group", False, [1, 1, 2, 2]),
        ("reviewed", False, [False, False, True, True]),
        (
            "published",
            False,
            [
                datetime(2026, 1, 1),
                datetime(2026, 1, 2),
                datetime(2026, 1, 3),
                datetime(2026, 1, 4),
            ],
        ),
    ],
)
def test_concordance_match_review_sorts_public_scalar_columns(
    tmp_path, sort_by: str, descending: bool, expected: list[object]
) -> None:
    path = _concordance_sort_artifact(tmp_path)

    result = _read_projected_sort(path, sort_by, descending)

    assert result[sort_by].to_list() == expected


def test_concordance_match_review_accepts_null_scalar_values(tmp_path) -> None:
    path = _concordance_sort_artifact(tmp_path)

    result = _read_projected_sort(path, "day")

    assert sorted(value for value in result["day"].to_list() if value is not None) == [
        date(2026, 1, 2),
        date(2026, 1, 3),
        date(2026, 1, 4),
    ]
    assert result["day"].null_count() == 1


@pytest.mark.parametrize(
    "sort_by",
    ["__wordflow_source_row_id", "nested_list", "nested_struct", "missing"],
)
def test_concordance_match_review_rejects_non_public_or_nested_sort_columns(
    tmp_path, sort_by: str
) -> None:
    path = _concordance_sort_artifact(tmp_path)

    with pytest.raises(InvalidInputError, match="sort column"):
        _projected_artifact_page(
            path,
            "concordance_run_all",
            "matches",
            "text",
            [
                "group",
                "reviewed",
                "published",
                "day",
                "nested_list",
                "nested_struct",
            ],
            CONCORDANCE_SORT_ANALYSIS_COLUMNS,
            1,
            10,
            sort_by,
            False,
        )


def test_concordance_match_review_uses_only_requested_sort_key(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = _concordance_sort_artifact(tmp_path)
    sort_calls: list[object] = []
    original_sort = pl.LazyFrame.sort

    def recording_sort(self, by, *more_by, **options):
        sort_calls.append(by)
        return original_sort(self, by, *more_by, **options)

    monkeypatch.setattr(pl.LazyFrame, "sort", recording_sort)

    _read_projected_sort(path, "CONC_l1")

    assert sort_calls == ["CONC_l1"]


def test_concordance_match_review_preserves_default_source_and_offset_order(
    tmp_path,
) -> None:
    path = _concordance_sort_artifact(tmp_path)

    result = _read_projected_sort(path, None)

    assert result["__wordflow_source_row_id"].to_list() == [0, 1, 2, 3]
    assert result["CONC_start_idx"].to_list() == [0, 10, 20, 30]


def test_quotation_match_review_still_rejects_generated_sort_columns(tmp_path) -> None:
    path = tmp_path / "quotation.parquet"
    pl.DataFrame(
        {
            "__wordflow_source_row_id": [0],
            "text": ["hello"],
            "quotation": [[{"quote": "hello", "quote_row_idx": 0}]],
        }
    ).write_parquet(path)

    with pytest.raises(InvalidInputError, match="sort column"):
        _projected_artifact_page(
            path,
            "quotation_run_all",
            "matches",
            "text",
            [],
            ["QUOTE_quote", "QUOTE_quote_row_idx"],
            1,
            10,
            "QUOTE_quote",
            False,
        )


def test_concordance_density_uses_all_documents_and_exact_match_text(tmp_path) -> None:
    path = tmp_path / "concordance.parquet"
    pl.DataFrame(
        {
            "text": ["Alpha beta alpha", "alpha beta"],
            "concordance": [
                [
                    {"CONC_matched_text": "Alpha", "CONC_start_idx": 0},
                    {"CONC_matched_text": "alpha", "CONC_start_idx": 11},
                ],
                [{"CONC_matched_text": "alpha", "CONC_start_idx": 0}],
            ],
        }
    ).write_parquet(path)

    result = _concordance_density(path, "text")

    assert result.document_count == 2
    assert result.match_count == 3
    assert [item.label for item in result.series] == ["Alpha", "alpha"]
    assert sum(result.series[0].counts) == 1
    assert sum(result.series[1].counts) == 2


def test_concordance_document_projection_filters_before_count_and_paging(
    tmp_path,
) -> None:
    path = tmp_path / "concordance.parquet"
    pl.DataFrame(
        {
            "__wordflow_source_row_id": [2, 7, 8],
            "text": ["Alpha beta alpha", "Alpha beta alpha", "beta only"],
            "group": ["first", "duplicate text", "none"],
            "concordance": [
                [
                    {
                        "CONC_matched_text": "Alpha",
                        "CONC_start_idx": 0,
                        "CONC_extraction": " Alpha ",
                    },
                    {
                        "CONC_matched_text": "alpha",
                        "CONC_start_idx": 11,
                        "CONC_extraction": "alpha",
                    },
                ],
                [
                    {
                        "CONC_matched_text": "alpha",
                        "CONC_start_idx": 11,
                        "CONC_extraction": "alpha",
                    }
                ],
                [
                    {
                        "CONC_matched_text": "beta",
                        "CONC_start_idx": 0,
                        "CONC_extraction": "beta",
                    }
                ],
            ],
        }
    ).write_parquet(path)

    result = _concordance_document_projection_page(
        path,
        "text",
        ["group"],
        ConcordanceDocumentProjectionQuery(
            page=1,
            page_size=1,
            excluded_matched_texts=["Alpha", "beta"],
            bin_count=4,
            selected_bins=[2],
        ),
    )
    frame = pl.read_ipc_stream(BytesIO(result.content))

    assert result.total_rows == 2
    assert result.has_next is True
    assert frame["__wordflow_source_row_id"].to_list() == [2]
    assert frame["group"].to_list() == ["first"]
    assert frame["concordance"].list.len().to_list() == [1]
    assert frame["concordance"].to_list()[0][0]["CONC_matched_text"] == "alpha"

    sorted_result = _concordance_document_projection_page(
        path,
        "text",
        ["group"],
        ConcordanceDocumentProjectionQuery(
            page=1,
            page_size=10,
            sort_by="group",
            excluded_matched_texts=["Alpha", "beta"],
        ),
    )
    sorted_frame = pl.read_ipc_stream(BytesIO(sorted_result.content))
    assert sorted_frame["__wordflow_source_row_id"].to_list() == [7, 2]


@pytest.mark.parametrize("bin_count", [4, 5, 10, 20, 25, 50, 100])
def test_concordance_document_projection_assigns_every_bin_boundary(
    tmp_path,
    bin_count: Literal[4, 5, 10, 20, 25, 50, 100],
) -> None:
    path = tmp_path / f"concordance-{bin_count}.parquet"
    document_length = 1000
    boundary_starts = [index * document_length // bin_count for index in range(bin_count)]
    matches = [
        {
            "CONC_matched_text": f"term-{index}",
            "CONC_start_idx": start,
            "CONC_extraction": f"term-{index}",
        }
        for index, start in enumerate(boundary_starts)
    ]
    matches.append(
        {
            "CONC_matched_text": "last-character",
            "CONC_start_idx": document_length - 1,
            "CONC_extraction": "last-character",
        }
    )
    pl.DataFrame(
        {
            "__wordflow_source_row_id": [1],
            "text": ["x" * document_length],
            "concordance": [matches],
        }
    ).write_parquet(path)

    for selected_bin in range(bin_count):
        result = _concordance_document_projection_page(
            path,
            "text",
            [],
            ConcordanceDocumentProjectionQuery(
                bin_count=bin_count,
                selected_bins=[selected_bin],
            ),
        )
        frame = pl.read_ipc_stream(BytesIO(result.content))
        filtered_matches = frame["concordance"].to_list()[0]
        assert filtered_matches[0]["CONC_start_idx"] == boundary_starts[selected_bin]
        assert all(
            min(match["CONC_start_idx"] * bin_count // document_length, bin_count - 1)
            == selected_bin
            for match in filtered_matches
        )
        if selected_bin == bin_count - 1:
            assert filtered_matches[-1]["CONC_start_idx"] == document_length - 1


@pytest.mark.parametrize(
    "payload",
    [
        {"excluded_matched_texts": ["alpha", "alpha"]},
        {"bin_count": 4},
        {"selected_bins": [0]},
        {"bin_count": 4, "selected_bins": [4]},
    ],
)
def test_concordance_document_projection_query_rejects_invalid_filters(
    payload: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        ConcordanceDocumentProjectionQuery.model_validate(payload)
