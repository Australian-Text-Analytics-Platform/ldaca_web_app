"""Strict immutable Oni settings accept only the canonical typed form."""

from typing import Any, cast

import pytest
from pydantic import ValidationError

from ldaca_wordflow.settings import Settings


def test_featured_collection_ids_preserve_arcp_identifiers_exactly() -> None:
    identifiers = (
        "arcp://name,hdl10.26180~23961609",
        "arcp://name,hdl10.26180~other",
    )
    settings = Settings(ldaca_oni_featured_collection_ids=identifiers)
    assert settings.ldaca_oni_featured_collection_ids == identifiers


def test_featured_collection_ids_reject_encoded_string_formats() -> None:
    with pytest.raises(ValidationError):
        Settings(
            ldaca_oni_featured_collection_ids=cast(
                Any, "arcp://name,hdl10.26180~23961609;arcp://name,other"
            ),
        )
