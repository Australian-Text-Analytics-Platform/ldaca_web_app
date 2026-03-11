import polars as pl
from ldaca_web_app_backend.api.workspaces.analyses.quotation_core import (
    empty_quote_dataframe,
    remote_payload_to_dataframe,
)


def test_empty_quote_dataframe_uses_prefixed_generated_columns():
    df = empty_quote_dataframe(text_column="document")

    assert df.columns == [
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
        "document",
    ]


def test_remote_payload_to_dataframe_emits_prefixed_generated_columns():
    df = remote_payload_to_dataframe({
        "results": [
            {
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
                ]
            }
        ]
    })

    assert df.to_dicts() == [
        {
            "QUOTE_quote_row_idx": 0,
            "QUOTE_speaker": "Ada",
            "QUOTE_speaker_start_idx": 1,
            "QUOTE_speaker_end_idx": 4,
            "QUOTE_quote": "Hello",
            "QUOTE_quote_start_idx": 5,
            "QUOTE_quote_end_idx": 10,
            "QUOTE_verb": "said",
            "QUOTE_verb_start_idx": 11,
            "QUOTE_verb_end_idx": 15,
            "QUOTE_quote_type": "direct",
            "QUOTE_quote_token_count": 1,
            "QUOTE_is_floating_quote": False,
        }
    ]
    assert df.schema["QUOTE_quote_row_idx"] == pl.Int64
