from ldaca_wordflow.infrastructure.providers.tabular_config import (
    _safe_corpus_config_filename,
    load_tabular_config,
)


def test_safe_corpus_config_filename_uses_windows_safe_arcp_id() -> None:
    filename = _safe_corpus_config_filename("arcp://name,hdl10.25949~24769173.v1")

    assert filename == "name,hdl10.25949~24769173.v1.json"


def test_load_tabular_config_uses_cooee_specific_config() -> None:
    config = load_tabular_config("arcp://name,hdl10.26180~23961609")

    assert "Place" in config["tables"]
    assert "RepositoryObject" not in config["tables"]


def test_load_tabular_config_uses_portal_url_crate_id() -> None:
    config = load_tabular_config(
        "https://data.ldaca.edu.au/collection?"
        "id=arcp%3A%2F%2Fname%2Chdl10.26181~23089559&"
        "_crateId=arcp%3A%2F%2Fname%2Chdl10.26181~23089559"
    )

    assert "Dataset" in config["tables"]
    assert "RepositoryObject" not in config["tables"]


def test_load_tabular_config_keeps_version_suffix_in_crate_id() -> None:
    config = load_tabular_config("arcp://name,hdl10.25949~24769173.v1")

    assert "CreativeWork" in config["tables"]
    assert "RepositoryObject" not in config["tables"]


def test_load_tabular_config_falls_back_to_general_config() -> None:
    config = load_tabular_config("arcp://name,unknown-corpus")

    assert "RepositoryObject" in config["tables"]
