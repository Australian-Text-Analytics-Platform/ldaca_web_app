import polars as pl
from ldaca_web_app_backend.core.worker import _materialize_to_polars_df


def test_materialize_accepts_polars_dataframe():
    df = pl.DataFrame({"text": ["hello", "world"]})

    result = _materialize_to_polars_df(df)

    assert isinstance(result, pl.DataFrame)
    assert result.to_dicts() == df.to_dicts()


def test_materialize_unwraps_docdataframe():
    try:
        from docframe import DocDataFrame
    except ImportError:  # pragma: no cover - docframe is a hard dependency
        raise AssertionError("docframe must be installed for backend tests")

    base = pl.DataFrame({"document": ["alpha", "beta"]})
    wrapped = DocDataFrame(base, document_column="document")

    result = _materialize_to_polars_df(wrapped)

    assert isinstance(result, pl.DataFrame)
    assert result.columns == ["document"]
    assert result.to_dicts() == base.to_dicts()
