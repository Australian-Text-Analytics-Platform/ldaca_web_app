import ldaca_web_app_backend.core.worker as worker


def test_worker_module_exposes_no_dataframe_materialize_shim():
    """Worker module should not expose coercion shims for uncertain dataframe types."""
    assert not hasattr(worker, "_materialize_to_polars_df")
