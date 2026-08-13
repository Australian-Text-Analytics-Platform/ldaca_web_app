import polars as pl
from ldaca_wordflow.analysis.quotation_core import (
    QUOTATION_GROUP_COLUMN,
    flatten_grouped_quotation_dataframe,
    remote_payload_to_grouped_dataframe,
)


def test_flatten_grouped_quotation_dataframe_uses_prefixed_generated_columns():
    grouped_df = pl.DataFrame(
        {
            "document": ["doc-1"],
            QUOTATION_GROUP_COLUMN: [
                [
                    {
                        "speaker": "Ada",
                        "speaker_start_idx": 1,
                        "speaker_end_idx": 4,
                        "quote": "Hello",
                        "quote_start_idx": 5,
                        "quote_end_idx": 10,
                        "verb": "said",
                        "verb_start_idx": 11,
                        "verb_end_idx": 15,
                        "quote_type": "direct",
                        "quote_token_count": 1,
                        "is_floating_quote": False,
                        "quote_row_idx": 0,
                    }
                ]
            ],
        }
    )
    df = flatten_grouped_quotation_dataframe(grouped_df)

    assert df.columns == [
        "document",
        "QUOTE_speaker",
        "QUOTE_speaker_start_idx",
        "QUOTE_speaker_end_idx",
        "QUOTE_quote",
        "QUOTE_quote_start_idx",
        "QUOTE_quote_end_idx",
        "QUOTE_verb",
        "QUOTE_verb_start_idx",
        "QUOTE_verb_end_idx",
        "QUOTE_quote_type",
        "QUOTE_quote_token_count",
        "QUOTE_is_floating_quote",
        "QUOTE_quote_row_idx",
    ]


def test_remote_payload_to_grouped_dataframe_attaches_quotes_by_identifier():
    df = remote_payload_to_grouped_dataframe(
        pl.DataFrame({"document": ["doc-1"]}),
        {
            "results": [
                {
                    "identifier": "0",
                    "quotes": [
                        {
                            "speaker": "Ada",
                            "speaker_start_idx": 1,
                            "speaker_end_idx": 4,
                            "quote": "Hello",
                            "quote_start_idx": 5,
                            "quote_end_idx": 10,
                            "verb": "said",
                            "verb_start_idx": 11,
                            "verb_end_idx": 15,
                            "quote_type": "direct",
                            "quote_token_count": 1,
                            "is_floating_quote": False,
                        }
                    ],
                }
            ]
        },
    )

    assert df.to_dicts() == [
        {
            "document": "doc-1",
            QUOTATION_GROUP_COLUMN: [
                {
                    "speaker": "Ada",
                    "speaker_start_idx": 1,
                    "speaker_end_idx": 4,
                    "quote": "Hello",
                    "quote_start_idx": 5,
                    "quote_end_idx": 10,
                    "verb": "said",
                    "verb_start_idx": 11,
                    "verb_end_idx": 15,
                    "quote_type": "direct",
                    "quote_token_count": 1,
                    "is_floating_quote": False,
                    "quote_row_idx": 0,
                }
            ],
        }
    ]
    assert str(df.schema[QUOTATION_GROUP_COLUMN]).startswith("List(")
