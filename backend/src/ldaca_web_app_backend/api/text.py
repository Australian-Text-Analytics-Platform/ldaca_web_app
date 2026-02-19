"""
Text analysis utility endpoints
"""

from functools import lru_cache
from importlib import resources
from typing import List

from fastapi import APIRouter

router = APIRouter(prefix="/text", tags=["text_analysis"])


@router.get("/default-stop-words")
async def get_default_stop_words(
    language: str = "english",
):
    """Return bundled default stop words for a language.

    Used by:
    - frontend token-frequency defaults loader

    Why:
    - Provides deterministic language stop-word sets from packaged resources.
    """
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
    """Load and cache stop words from packaged resource text files.

    Used by:
    - `get_default_stop_words`

    Why:
    - Avoids repeated disk/resource reads for common language requests.
    """
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
