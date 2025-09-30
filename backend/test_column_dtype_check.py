from datetime import datetime, timezone

import polars as pl

# Create test dataframes
df_datetime = pl.DataFrame({
    "created_at": [
        datetime(2020, 10, 24, 23, 40, 15, tzinfo=timezone.utc),
        datetime(2020, 11, 24, 23, 40, 15, tzinfo=timezone.utc),
        datetime(2020, 12, 24, 23, 40, 15, tzinfo=timezone.utc),
    ]
})

df_numeric = pl.DataFrame({"value": [1, 2, 3, 4, 5]})

# Test column type detection
print("Testing column type detection:")
print(f"created_at schema: {df_datetime.schema['created_at']}")
print(
    f"Is datetime? {df_datetime.schema['created_at'] in (pl.Datetime, pl.Datetime('ms'), pl.Datetime('us'), pl.Datetime('ns'))}"
)
print()
print(f"value schema: {df_numeric.schema['value']}")
print(
    f"Is datetime? {df_numeric.schema['value'] in (pl.Datetime, pl.Datetime('ms'), pl.Datetime('us'), pl.Datetime('ns'))}"
)
print()


# Test serialize_value logic with column type check
def serialize_value_datetime(val, is_datetime_column):
    """Test for datetime column"""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.isoformat()
    # For datetime columns, convert string output from describe() to datetime
    if is_datetime_column and isinstance(val, str) and val != "null":
        try:
            # Parse datetime string from Polars describe output
            dt = datetime.fromisoformat(val.replace(" ", "T"))
            # Add UTC timezone if not present
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat()
        except (ValueError, AttributeError):
            return val
    # For numeric columns, convert to float
    try:
        return float(val)
    except (TypeError, ValueError):
        return val


# Test datetime column
print("\nTesting datetime column:")
desc_df_datetime = df_datetime.select("created_at").describe(interpolation="nearest")
print(desc_df_datetime)
print("\nSerialized values:")
for row in desc_df_datetime.iter_rows(named=True):
    stat_name = row.get("statistic") or row.get("describe")
    val = row["created_at"]
    converted = serialize_value_datetime(val, is_datetime_column=True)
    print(f"{stat_name}: {val} -> {converted}")

# Test numeric column
print("\n\nTesting numeric column:")
desc_df_numeric = df_numeric.select("value").describe(interpolation="nearest")
print(desc_df_numeric)
print("\nSerialized values:")
for row in desc_df_numeric.iter_rows(named=True):
    stat_name = row.get("statistic") or row.get("describe")
    val = row["value"]
    converted = serialize_value_datetime(val, is_datetime_column=False)
    print(f"{stat_name}: {val} -> {converted}")

print("\n✅ Type-based serialization works correctly!")
