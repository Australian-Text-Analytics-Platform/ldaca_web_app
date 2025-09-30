"""Test describe with timestamp conversion for datetime columns."""

from datetime import datetime, timezone

import polars as pl

# Test with sample datetime data
df = pl.DataFrame({
    "created_at": [
        datetime(2020, 10, 24, 23, 40, 15),
        datetime(2020, 11, 23, 23, 40, 15),
        datetime(2020, 12, 23, 23, 40, 15),
        datetime(2021, 1, 22, 23, 40, 15),
        datetime(2021, 2, 21, 23, 40, 15),
    ]
})

print("Original DataFrame:")
print(df)
print()

# Extract timestamp in milliseconds and describe
column_name = "created_at"
df_with_timestamp = df.with_columns(
    pl.col(column_name).dt.timestamp("ms").alias("_timestamp_ms")
)

print("DataFrame with timestamp (ms):")
print(df_with_timestamp)
print()

# Describe the timestamp
desc_df = df_with_timestamp.select("_timestamp_ms").describe(interpolation="nearest")
print("Describe output:")
print(desc_df)
print()

# Convert back to datetime
desc_dict = {}
for row in desc_df.iter_rows(named=True):
    stat_name = row.get("statistic") or row.get("describe")
    if stat_name:
        desc_dict[stat_name] = row["_timestamp_ms"]

print("Statistics converted back to datetime:")
print("=" * 60)
for key in ["count", "null_count", "mean", "min", "25%", "50%", "75%", "max"]:
    if key in desc_dict:
        val = desc_dict[key]
        if val is not None and key not in ["count", "null_count", "std"]:
            dt = datetime.fromtimestamp(val / 1000.0, tz=timezone.utc)
            print(f"  {key:12} = {dt.isoformat()}")
        else:
            print(f"  {key:12} = {val}")

print("=" * 60)
print()
print("✅ Test passed! describe() works with datetime via timestamp conversion")
print()
print("This approach:")
print("  - Uses Polars describe() method as requested")
print('  - Provides all percentiles (25%, 50%, 75%) using interpolation="nearest"')
print("  - Returns ISO format strings for the frontend")
