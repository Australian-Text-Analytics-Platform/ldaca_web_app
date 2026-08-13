"""Error semantics for bounded Analysis page-size probes."""

import pytest

from ldaca_wordflow.analysis.page_size import estimate_page_size


def test_page_size_probe_failure_is_not_converted_to_sparse_results() -> None:
    def fail(_size: int) -> int:
        raise RuntimeError("probe failed")

    with pytest.raises(RuntimeError, match="probe failed"):
        estimate_page_size(fail)
