"""Demo script showing the describe endpoint fix for datetime columns."""

from datetime import datetime, timedelta, timezone

import polars as pl


def test_datetime_describe_logic():
    """Demonstrates the fixed logic using describe() with timestamp conversion."""

    # Create sample data similar to user's 'created_at' column
    base_date = datetime(2020, 10, 24, 23, 40, 15)
    dates = [base_date + timedelta(days=i * 30) for i in range(12)]  # Monthly dates

    df = pl.DataFrame({"created_at": dates, "user_id": list(range(1, 13))})

    print("=" * 60)
    print("Sample DataFrame:")
    print(df)
    print()

    # Simulate what the endpoint does for datetime columns
    column_name = "created_at"
    column_dtype = df.schema[column_name]

    print(f"Column: {column_name}")
    print(f"Data type: {column_dtype}")
    print(f"Is datetime: {column_dtype in [pl.Datetime, pl.Date, pl.Time]}")
    print()

    # NEW APPROACH: Use describe() with timestamp conversion
    df_with_timestamp = df.with_columns(
        pl.col(column_name).dt.timestamp("ms").alias("_timestamp_ms")
    )

    # Describe the timestamp
    desc_df = df_with_timestamp.select("_timestamp_ms").describe(
        interpolation="nearest"
    )

    # Convert to dict
    desc_dict = {}
    for row in desc_df.iter_rows(named=True):
        stat_name = row.get("statistic") or row.get("describe")
        if stat_name:
            desc_dict[stat_name] = row["_timestamp_ms"]

    # Convert timestamp values back to datetime
    def timestamp_to_datetime(ts_ms):
        if ts_ms is None:
            return None
        dt = datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc)
        return dt.isoformat()

    print("Statistics (using describe() with timestamp conversion):")
    print("-" * 60)
    stats = {
        "count": int(desc_dict.get("count", 0))
        if desc_dict.get("count") is not None
        else None,
        "null_count": int(desc_dict.get("null_count", 0))
        if desc_dict.get("null_count") is not None
        else None,
        "mean": timestamp_to_datetime(desc_dict.get("mean")),
        "min": timestamp_to_datetime(desc_dict.get("min")),
        "25%": timestamp_to_datetime(desc_dict.get("25%")),
        "median": timestamp_to_datetime(desc_dict.get("50%")),
        "75%": timestamp_to_datetime(desc_dict.get("75%")),
        "max": timestamp_to_datetime(desc_dict.get("max")),
    }

    for key, value in stats.items():
        print(f"  {key:15} = {value}")

    print()
    print("✅ Success! Using Polars describe() method as requested")
    print()
    print("Filter pre-fill mapping:")
    print(f"  - Equals operator    → median:  {stats['median']}")
    print(f"  - After/equal        → min:     {stats['min']}")
    print(f"  - Before/equal       → max:     {stats['max']}")
    print(f"  - Between            → min/max: {stats['min']} to {stats['max']}")
    print("=" * 60)


if __name__ == "__main__":
    test_datetime_describe_logic()
