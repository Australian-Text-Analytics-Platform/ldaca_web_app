"""
Text analysis utility endpoints
"""

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
        # Lazy import: only load NLTK when endpoint is actually called
        import nltk

        nltk.download("stopwords", quiet=True)
        from nltk.corpus import stopwords

        return {"stopwords": stopwords.words(language)}
    except Exception as e:
        return {"error": f"Failed to load stopwords: {str(e)}", "stopwords": []}
