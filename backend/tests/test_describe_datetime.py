"""Test describe endpoint with datetime columns."""

from datetime import datetime, timedelta

import polars as pl


def test_describe_datetime_column():
    """Test that describe works correctly with datetime columns."""
    # Create a sample datetime dataframe
    base_date = datetime(2020, 1, 1)
    dates = [base_date + timedelta(days=i) for i in range(10)]

    df = pl.DataFrame({"created_at": dates, "value": list(range(10))})

    # Test datetime column aggregations
    stats = df.select([
        pl.col("created_at").count().alias("count"),
        pl.col("created_at").null_count().alias("null_count"),
        pl.col("created_at").min().alias("min"),
        pl.col("created_at").max().alias("max"),
        pl.col("created_at").median().alias("median"),
    ]).to_dicts()[0]

    # Calculate percentiles via sorting
    sorted_col = df.select("created_at").drop_nulls().sort("created_at")
    n = len(sorted_col)
    idx_25 = max(0, int(n * 0.25) - 1)
    idx_75 = max(0, int(n * 0.75) - 1)
    stats["25%"] = sorted_col[idx_25, "created_at"]
    stats["75%"] = sorted_col[idx_75, "created_at"]

    assert stats["count"] == 10
    assert stats["null_count"] == 0
    assert stats["min"] == base_date
    assert stats["max"] == base_date + timedelta(days=9)
    assert stats["median"] is not None
    assert stats["25%"] is not None
    assert stats["75%"] is not None

    # Test that datetime values can be serialized to ISO format
    assert isinstance(stats["min"], datetime)
    iso_string = stats["min"].isoformat()
    assert isinstance(iso_string, str)
    assert "2020-01-01" in iso_string


def test_describe_numeric_column():
    """Test that describe still works with numeric columns."""
    df = pl.DataFrame({"value": [1.0, 2.0, 3.0, 4.0, 5.0]})

    desc_df = df.select("value").describe(interpolation="nearest")
    desc_dict = {}
    for row in desc_df.iter_rows(named=True):
        stat_name = row.get("statistic") or row.get("describe")
        if stat_name:
            desc_dict[stat_name] = row["value"]

    assert desc_dict["count"] == 5.0
    assert desc_dict["mean"] == 3.0
    assert desc_dict["min"] == 1.0
    assert desc_dict["max"] == 5.0
    assert desc_dict["50%"] == 3.0


def test_datetime_type_detection():
    """Test that we can correctly detect datetime column types."""
    df = pl.DataFrame({
        "datetime_col": [datetime(2020, 1, 1), datetime(2020, 1, 2)],
        "date_col": [datetime(2020, 1, 1).date(), datetime(2020, 1, 2).date()],
        "numeric_col": [1.0, 2.0],
        "string_col": ["a", "b"],
    })

    # Check datetime detection
    assert df.schema["datetime_col"] == pl.Datetime
    assert df.schema["date_col"] == pl.Date
    assert df.schema["numeric_col"] == pl.Float64
    assert df.schema["string_col"] == pl.String

    # Test that our detection logic would work
    for col_name in ["datetime_col", "date_col"]:
        column_dtype = df.schema[col_name]
        is_datetime = column_dtype in [pl.Datetime, pl.Date, pl.Time] or str(
            column_dtype
        ).startswith("Datetime")
        assert is_datetime, f"Failed to detect {col_name} as datetime"

    # Test numeric column is not detected as datetime
    column_dtype = df.schema["numeric_col"]
    is_datetime = column_dtype in [pl.Datetime, pl.Date, pl.Time] or str(
        column_dtype
    ).startswith("Datetime")
    assert not is_datetime
