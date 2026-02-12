"""
Text analysis utility endpoints
"""

from functools import lru_cache
from importlib import resources
from typing import List

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/text", tags=["text_analysis"])


class StopWordConfig(BaseModel):
    """Configuration for stop word options"""

    language: str = "english"
    custom_words: List[str] = []  # Additional stop words to add


@router.get("/default-stop-words")
async def get_default_stop_words(
    language: str = "english",
):
    """Get default stop words for a language."""
    try:
        return {"stopwords": _load_stopwords(language)}
    except Exception as e:
        return {"error": f"Failed to load stopwords: {str(e)}", "stopwords": []}


LANGUAGE_FILE_MAP = {
    "english": "stopwords_en.txt",
    "en": "stopwords_en.txt",
    "spanish": "stopwords_es.txt",
    "es": "stopwords_es.txt",
    "french": "stopwords_fr.txt",
    "fr": "stopwords_fr.txt",
    "german": "stopwords_de.txt",
    "de": "stopwords_de.txt",
}


@lru_cache(maxsize=32)
def _load_stopwords(language: str) -> List[str]:
    normalized = (language or "english").strip().lower()
    filename = LANGUAGE_FILE_MAP.get(normalized, LANGUAGE_FILE_MAP["english"])
    text = (
        resources
        .files("ldaca_web_app_backend.resources")
        .joinpath(filename)
        .read_text(encoding="utf-8")
    )
    return [
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
