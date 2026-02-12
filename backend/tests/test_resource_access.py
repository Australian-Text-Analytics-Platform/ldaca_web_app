"""Tests for packaged backend resources."""

from __future__ import annotations

from importlib import resources
from pathlib import Path

from ldaca_web_app_backend.core.utils import (
    get_user_data_folder,
    import_sample_data_for_user,
)
from ldaca_web_app_backend.settings import settings


def _resource_path(relative: str) -> Path:
    """Resolve a resource path to a filesystem path."""
    target = resources.files("ldaca_web_app_backend.resources").joinpath(relative)
    with resources.as_file(target) as resolved:
        return resolved


def test_sample_data_resources_exist():
    sample_root = _resource_path("sample_data")
    assert sample_root.exists()
    assert (sample_root / "ADO" / "candidate_info_gender.csv").is_file()
    assert (sample_root / "Hansard" / "economy_agenda.csv").is_file()
    assert (sample_root / "example.txt").is_file()


def test_binary_sample_resources_present():
    sample_root = _resource_path("sample_data")
    zip_file = sample_root / "zip_example" / "data.zip"
    xlsx_file = sample_root / "example_quotations" / "sample_texts.xlsx"
    assert zip_file.is_file()
    assert xlsx_file.is_file()
    assert zip_file.stat().st_size > 0
    assert xlsx_file.stat().st_size > 0


def test_nginx_template_resource():
    nginx_template = _resource_path("configs/nginx.conf.template")
    assert nginx_template.is_file()
    content = nginx_template.read_text(encoding="utf-8")
    assert "FRONTEND_DIR" in content
    assert "BACKEND_PORT" in content


def test_stopwords_resources():
    stopwords_dir = resources.files("ldaca_web_app_backend.resources")
    languages = ["en", "es", "fr", "de"]
    for lang in languages:
        path = stopwords_dir.joinpath(f"stopwords_{lang}.txt")
        with resources.as_file(path) as resolved:
            assert resolved.is_file()
            content = resolved.read_text(encoding="utf-8")
            assert content.strip(), f"Stopwords file {path} should not be empty"


def test_import_sample_data_uses_packaged_resources(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_root", tmp_path)
    monkeypatch.setattr(settings, "user_data_folder", "users")
    monkeypatch.setattr(settings, "sample_data", None)

    summary = import_sample_data_for_user("test")

    user_data_dir = get_user_data_folder("test")
    target_sample = user_data_dir / "sample_data"
    assert target_sample.exists()
    assert (target_sample / "ADO" / "candidate_info_gender.csv").is_file()
    assert summary["file_count"] > 0
    assert summary["bytes_copied"] > 0
    assert summary["bytes_copied"] > 0
    assert (target_sample / "ADO" / "candidate_info_gender.csv").is_file()
    assert summary["file_count"] > 0
    assert summary["bytes_copied"] > 0
