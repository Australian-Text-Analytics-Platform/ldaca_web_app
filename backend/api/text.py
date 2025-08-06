"""
Text analysis utility endpoints
"""

from fastapi import APIRouter, HTTPException

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
        # Try to import NLTK and get stop words
        try:
            import nltk
            from nltk.corpus import stopwords

            # Download stopwords if not already present
            try:
                nltk.data.find("corpora/stopwords")
            except LookupError:
                nltk.download("stopwords")

            # Get English stop words
            stop_words = list(stopwords.words("english"))

            return {
                "success": True,
                "message": f"Retrieved {len(stop_words)} default stop words",
                "data": stop_words,
            }

        except ImportError:
            # Fallback to a basic list if NLTK is not available
            basic_stop_words = [
                "a",
                "an",
                "and",
                "are",
                "as",
                "at",
                "be",
                "by",
                "for",
                "from",
                "has",
                "he",
                "in",
                "is",
                "it",
                "its",
                "of",
                "on",
                "that",
                "the",
                "to",
                "was",
                "will",
                "with",
                "the",
                "this",
                "but",
                "they",
                "have",
                "had",
                "what",
                "said",
                "each",
                "which",
                "their",
                "time",
                "if",
                "up",
                "out",
                "many",
                "then",
                "them",
                "these",
                "so",
                "some",
                "her",
                "would",
                "make",
                "like",
                "into",
                "him",
                "two",
                "more",
                "go",
                "no",
                "way",
                "could",
                "my",
                "than",
                "first",
                "been",
                "call",
                "who",
                "oil",
                "sit",
                "now",
                "find",
                "down",
                "day",
                "did",
                "get",
                "come",
                "made",
                "may",
                "part",
            ]

            return {
                "success": True,
                "message": f"Retrieved {len(basic_stop_words)} basic stop words (NLTK not available)",
                "data": basic_stop_words,
            }

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error retrieving stop words: {str(e)}"
        )
