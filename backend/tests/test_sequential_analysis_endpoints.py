"""Compatibility test module for legacy sequential-analysis endpoint test path.

Primary sequential-analysis endpoint persistence coverage now lives in
`tests/integration/test_analysis_persistence.py`.
"""


def test_sequential_analysis_endpoints_compatibility_path_exists():
    """Keep legacy pytest target path resolvable for CI/local command compatibility."""

    assert True
