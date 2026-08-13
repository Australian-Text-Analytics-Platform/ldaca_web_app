"""Strict Data Portal document selection and materialization."""

from pathlib import Path

import polars as pl
import pytest

from ldaca_wordflow.workers.data_portal import (
    _content_size,
    _select_text_documents,
    _tabulate_metadata,
    _write_documents,
)


def test_select_text_documents_prefers_plain_text_derivatives() -> None:
    metadata = {
        "@graph": [
            {
                "@id": "arcp://name,example/work/1",
                "@type": "CreativeWork",
                "name": "Document 1",
                "dateCreated": "1788",
            },
            {
                "@id": "https://data.ldaca.edu.au/api/stream?path=data%2F1.txt",
                "@type": ["File"],
                "name": "Document 1 with codes",
                "encodingFormat": ["text/plain"],
                "contentSize": "20",
                "ldac:annotationOf": {"@id": "arcp://name,example/work/1"},
            },
            {
                "@id": (
                    "https://data.ldaca.edu.au/api/stream?"
                    "path=data%2F1-plain.txt"
                ),
                "@type": ["File"],
                "name": "Document 1 plain",
                "encodingFormat": ["text/plain"],
                "contentSize": "18",
                "ldac:annotationOf": {"@id": "arcp://name,example/work/1"},
            },
        ]
    }

    assert _select_text_documents(metadata) == [
        {
            "file_id": (
                "https://data.ldaca.edu.au/api/stream?"
                "path=data%2F1-plain.txt"
            ),
            "path": "data/1-plain.txt",
            "name": "Document 1 plain",
            "encoding_format": "text/plain",
            "content_size": 18,
            "annotation_of": "arcp://name,example/work/1",
            "work_name": "Document 1",
            "date_created": "1788",
        }
    ]


def test_document_materialization_requires_every_downloaded_text(
    tmp_path: Path,
) -> None:
    with pytest.raises(KeyError, match="missing.txt"):
        _write_documents(
            [{"path": "missing.txt"}],
            {},
            tmp_path / "documents.parquet",
        )


def test_metadata_tabulation_flattens_only_the_selected_configured_table(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    metadata = {
        "@graph": [
            {
                "@id": "work-1",
                "@type": "CreativeWork",
                "name": "Interview",
                "author": {"@id": "person-1"},
                "keyword": ["speech", "archive"],
                "internal": "discarded",
            },
            {
                "@id": "person-1",
                "@type": "Person",
                "name": "Researcher",
                "role": ["speaker", "collector"],
                "affiliation": {"@id": "org-1"},
            },
            {
                "@id": "org-1",
                "@type": "Organization",
                "name": "LDaCA",
            },
        ]
    }
    config = {
        "tables": {
            "CreativeWork": {
                "expand_props": ["author"],
                "ignore_props": ["@type", "internal", "author_@type"],
                "all_props": [],
            },
            "Person": {
                "expand_props": [],
                "ignore_props": [],
                "all_props": [],
            },
        }
    }
    monkeypatch.setattr(
        "ldaca_wordflow.workers.data_portal.load_tabular_config",
        lambda _identifier: config,
    )
    destination = tmp_path / "metadata.parquet"

    _tabulate_metadata("arcp://name,example", metadata, destination)

    assert pl.read_parquet(destination).to_dicts() == [
        {
            "entity_id": "work-1",
            "name": "Interview",
            "author_name": "Researcher",
            "author_role": "speaker",
            "author_role_1": "collector",
            "author_affiliation": "LDaCA",
            "author_affiliation_id": "org-1",
            "keyword": "speech",
            "keyword_1": "archive",
        }
    ]


def test_metadata_tabulation_rejects_an_empty_table_contract(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "ldaca_wordflow.workers.data_portal.load_tabular_config",
        lambda _identifier: {"tables": {}},
    )

    with pytest.raises(ValueError, match="has no tables"):
        _tabulate_metadata(
            "arcp://name,example",
            {"@graph": []},
            tmp_path / "metadata.parquet",
        )


@pytest.mark.parametrize("value", ["invalid", "-1"])
def test_invalid_declared_content_sizes_are_not_trusted(value: str) -> None:
    assert _content_size(value) is None
