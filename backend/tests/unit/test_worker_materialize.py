import polars as pl
from ldaca_web_app_backend.core.worker import _materialize_to_polars_df


def test_materialize_accepts_polars_dataframe():
    df = pl.DataFrame({"text": ["hello", "world"]})

    result = _materialize_to_polars_df(df)

    assert isinstance(result, pl.DataFrame)
    assert result.to_dicts() == df.to_dicts()
