"""Pytest configuration and shared fixtures for docworkspace tests."""

import polars as pl
import pytest

from docframe import DocDataFrame


@pytest.fixture
def sample_dataframe():
    """Create a sample polars DataFrame for testing."""
    return pl.DataFrame(
        {
            "id": [1, 2, 3, 4, 5],
            "text": ["apple", "banana", "cherry", "date", "elderberry"],
            "value": [10, 20, 30, 40, 50],
            "category": ["fruit", "fruit", "fruit", "fruit", "fruit"],
        }
    )


@pytest.fixture
def sample_lazyframe():
    """Create a sample polars LazyFrame for testing."""
    return pl.LazyFrame(
        {
            "id": [1, 2, 3, 4, 5],
            "text": ["apple", "banana", "cherry", "date", "elderberry"],
            "value": [10, 20, 30, 40, 50],
            "category": ["fruit", "fruit", "fruit", "fruit", "fruit"],
        }
    )


@pytest.fixture
def sample_docdataframe(sample_dataframe):
    """Create a sample DocDataFrame for testing."""
    return DocDataFrame(sample_dataframe, document_column="text")


@pytest.fixture
def sample_lazy_docdataframe(sample_lazyframe):
    """Create a sample DocDataFrame with LazyFrame for testing."""
    return DocDataFrame(sample_lazyframe, document_column="text")


@pytest.fixture(autouse=True)
def cleanup_temp_files(request):
    """Automatically clean up any temporary files created during tests."""
    import shutil
    import tempfile

    temp_dirs = []

    def track_temp_dir():
        temp_dir = tempfile.mkdtemp()
        temp_dirs.append(temp_dir)
        return temp_dir

    request.track_temp_dir = track_temp_dir

    yield

    # Cleanup
    for temp_dir in temp_dirs:
        try:
            shutil.rmtree(temp_dir)
        except Exception:
            pass
