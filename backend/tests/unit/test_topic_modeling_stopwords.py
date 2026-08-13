"""Vectorizer routing for the Rust topic-modeling pipeline.

The Rust topic-modeling pipeline tokenizes the topic text itself for c-TF-IDF,
so the Python side only decides *which* segmenter the pipeline should use
(plain English words vs a lindera CJK dictionary). Stopwords and display caps
are presentation settings and never enter this computation boundary.
"""

from __future__ import annotations

from ldaca_wordflow.workers.topic_pipeline import (
    _LINDERA_JA_VECTORIZER,
    _LINDERA_KO_VECTORIZER,
    _LINDERA_ZH_VECTORIZER,
    _PLAIN_WORDS_EN_VECTORIZER,
    _resolve_vectorizer_model,
)


# ---------------------------------------------------------------------------
# Vectorizer/stopword routing by document script.
# ---------------------------------------------------------------------------


def test_english_corpus_routes_to_plain_words() -> None:
    docs = [
        "The market rallied today as investors bought shares.",
        "Rain is expected across the region this weekend.",
    ]
    assert _resolve_vectorizer_model(docs) == _PLAIN_WORDS_EN_VECTORIZER


def test_chinese_corpus_routes_to_lindera_zh() -> None:
    docs = ["市场今天上涨投资者纷纷买入股票", "本周末预计全区都会下雨"]
    assert _resolve_vectorizer_model(docs) == _LINDERA_ZH_VECTORIZER


def test_japanese_corpus_routes_to_lindera_ja() -> None:
    docs = ["今日は市場が上昇しました。", "週末は雨が降るでしょう。"]
    assert _resolve_vectorizer_model(docs) == _LINDERA_JA_VECTORIZER


def test_korean_corpus_routes_to_lindera_ko() -> None:
    docs = ["오늘 시장이 상승했습니다", "주말에 비가 올 것입니다"]
    assert _resolve_vectorizer_model(docs) == _LINDERA_KO_VECTORIZER


def test_empty_corpus_defaults_to_english_plain_words() -> None:
    assert _resolve_vectorizer_model([]) == _PLAIN_WORDS_EN_VECTORIZER
