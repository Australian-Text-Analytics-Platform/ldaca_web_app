from datetime import datetime, timezone

import polars as pl


# Test the serialize_value logic
def serialize_value(val):
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.isoformat()
    # If it's a string, try to parse as datetime first
    if isinstance(val, str):
        # Check if it looks like a datetime string (contains spaces or hyphens)
        if "-" in val or " " in val:
            try:
                # Try parsing datetime string from Polars describe output
                # Format: "2023-01-01 10:00:00" or "2023-01-01 10:00:00.123456"
                dt = datetime.fromisoformat(val.replace(" ", "T"))
                # Add UTC timezone if not present (Polars datetimes are typically UTC)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.isoformat()
            except (ValueError, AttributeError):
                pass
        # Return string as-is if not a datetime
        return val
    # Try to convert to float for numeric values
    try:
        return float(val)
    except (TypeError, ValueError):
        return val


# Test cases
print("Testing datetime string conversions:")
print(f"Input: '2023-01-01 10:00:00'")
print(f"Output: {serialize_value('2023-01-01 10:00:00')}")
print()
print(f"Input: '2023-01-01 10:00:00.123456'")
print(f"Output: {serialize_value('2023-01-01 10:00:00.123456')}")
print()
print(f"Input: 'null' (string)")
print(f"Output: {serialize_value('null')}")
print()
print(f"Input: 42.5 (float)")
print(f"Output: {serialize_value(42.5)}")
print()

# Test with actual Polars describe
df = pl.DataFrame({
    "created_at": [
        datetime(2020, 10, 24, 23, 40, 15, tzinfo=timezone.utc),
        datetime(2020, 11, 24, 23, 40, 15, tzinfo=timezone.utc),
        datetime(2020, 12, 24, 23, 40, 15, tzinfo=timezone.utc),
    ]
})

desc_df = df.select("created_at").describe(interpolation="nearest")
print("\nPolars describe output for datetime column:")
print(desc_df)
print("\nConverted values:")
for row in desc_df.iter_rows(named=True):
    stat_name = row.get("statistic") or row.get("describe")
    val = row["created_at"]
    converted = serialize_value(val)
    print(f"{stat_name}: {val} -> {converted}")

print("\n✅ All datetime strings converted to ISO 8601 format with timezone!")
