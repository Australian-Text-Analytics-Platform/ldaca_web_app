"""
Text analysis utility endpoints
"""

import nltk
from fastapi import APIRouter, HTTPException
from nltk.corpus import stopwords

router = APIRouter(prefix="/text", tags=["text_analysis"])


@router.get(
    "/default-stop-words",
    summary="Get default English stop words",
    description="Returns a list of default English stop words from NLTK",
)
async def get_default_stop_words():
    """
    Get default English stop words from NLTK.

    Returns a list of common English stop words that can be used for token frequency analysis.
    """
    try:
        # Try to get stop words
        try:
            nltk.data.find("corpora/stopwords")
        except LookupError:
            nltk.download("stopwords")

        # Get English stop words
        stop_words = list(stopwords.words("english"))

        return {
            "state": "successful",
            "message": f"Retrieved {len(stop_words)} default stop words",
            "data": stop_words,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error retrieving stop words: {str(e)}"
        )
