"""
Sample data fixtures for testing
"""

import pandas as pd
import polars as pl

# Sample DataFrame data
SAMPLE_DATAFRAME_DATA = [
    {"name": "Alice", "age": 25, "city": "New York"},
    {"name": "Bob", "age": 30, "city": "London"},
    {"name": "Charlie", "age": 35, "city": "Tokyo"},
]

SAMPLE_TEXT_DATA = [
    {"document_id": 1, "text": "This is a sample document about machine learning."},
    {
        "document_id": 2,
        "text": "Another document discussing natural language processing.",
    },
    {"document_id": 3, "text": "A third document on artificial intelligence topics."},
]

# CSV content for file testing
SAMPLE_CSV_CONTENT = """name,age,city
Alice,25,New York
Bob,30,London
Charlie,35,Tokyo"""

SAMPLE_JSON_CONTENT = """[
    {"name": "Alice", "age": 25, "city": "New York"},
    {"name": "Bob", "age": 30, "city": "London"},
    {"name": "Charlie", "age": 35, "city": "Tokyo"}
]"""

SAMPLE_TEXT_CSV_CONTENT = """document_id,text
1,"This is a sample document about machine learning."
2,"Another document discussing natural language processing."
3,"A third document on artificial intelligence topics."
"""


def create_sample_pandas_df():
    """Create a sample pandas DataFrame"""
    return pd.DataFrame(SAMPLE_DATAFRAME_DATA)


def create_sample_polars_df():
    """Create a sample polars DataFrame"""
    return pl.DataFrame(SAMPLE_DATAFRAME_DATA)


def create_sample_text_df():
    """Create a sample text DataFrame for document processing"""
    return pd.DataFrame(SAMPLE_TEXT_DATA)
