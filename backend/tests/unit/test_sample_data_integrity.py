"""Remote sample catalogues must map to safe public destinations."""

import pytest
from pydantic import ValidationError

from ldaca_wordflow.models.data_sources import (
    SampleCatalogueResource,
    SampleCollection,
    SampleFile,
    sample_destination_path,
)


def test_collection_manifest_requires_exact_total_and_unique_paths() -> None:
    file = SampleFile(path="sample/data.csv", size=3)

    with pytest.raises(ValidationError, match="total_size_bytes"):
        SampleCollection(
            id="sample",
            name="Sample",
            total_size_bytes=4,
            files=[file],
        )
    with pytest.raises(ValidationError, match="distinct"):
        SampleCollection(
            id="sample",
            name="Sample",
            total_size_bytes=6,
            files=[file, file],
        )
def test_hierarchical_collection_paths_are_relative_to_the_collection() -> None:
    assert sample_destination_path(
        "ADO/twitter",
        "ADO/twitter/README.md",
    ).as_posix() == "README.md"
    with pytest.raises(ValueError, match="contained"):
        sample_destination_path("ADO/twitter", "ADO/reddit/data.parquet")


def test_repository_only_fields_are_not_part_of_the_public_resource() -> None:
    catalogue = SampleCatalogueResource.model_validate(
        {
            "schema_version": 1,
            "collections": [
                {
                    "id": "ADO/twitter",
                    "name": "ADO Twitter",
                    "bundled": True,
                    "total_size_bytes": 3,
                    "files": [
                        {
                            "path": "ADO/twitter/data.csv",
                            "size": 3,
                            "sha256": "0" * 64,
                        }
                    ],
                }
            ],
        }
    )

    payload = catalogue.model_dump(mode="json")
    assert "bundled" not in payload["collections"][0]
    assert "sha256" not in payload["collections"][0]["files"][0]


def test_catalogue_requires_unique_portable_collection_ids() -> None:
    collection = SampleCollection(
        id="sample",
        name="Sample",
        total_size_bytes=0,
        files=[],
    )
    hierarchical = SampleCollection(
        id="ADO/twitter",
        name="ADO Twitter",
        total_size_bytes=0,
        files=[],
    )
    assert hierarchical.id == "ADO/twitter"
    with pytest.raises(ValidationError, match="collection IDs"):
        SampleCatalogueResource(
            schema_version=1,
            collections=[
                collection,
                collection.model_copy(update={"id": "SAMPLE"}),
            ],
        )
    for collection_id in (".", "..", "CON", "name."):
        with pytest.raises(ValidationError, match="not portable"):
            SampleCollection(
                id=collection_id,
                name="Invalid",
                total_size_bytes=0,
                files=[],
            )


def test_catalogue_rejects_unknown_schema_versions() -> None:
    with pytest.raises(ValidationError):
        SampleCatalogueResource.model_validate(
            {"schema_version": 2, "collections": []}
        )
