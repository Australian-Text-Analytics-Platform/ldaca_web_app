"""Feedback endpoint for submitting user feedback to Airtable.

Follows architectural principles:
- Thin API layer delegating to external service (Airtable via pyairtable)
- Deterministic JSON response (no Polars objects)
- Auth required (even in single-user mode returns root user)
"""

import os
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from ..config import settings
from ..core.auth import get_current_user
from ..models import FeedbackRequest, FeedbackResponse

# Avoid importing pyairtable at module import time; detect availability cheaply
try:
    import importlib.util as _il_util

    _HAS_PYAIRTABLE = _il_util.find_spec("pyairtable") is not None
except Exception:  # pragma: no cover
    _HAS_PYAIRTABLE = False
Table = None  # type: ignore

router = APIRouter(prefix="/feedback", tags=["feedback"])


def _airtable_available() -> bool:
    # Disable network side-effects during test runs
    if os.getenv("PYTEST_CURRENT_TEST"):
        return False
    return bool(
        settings.airtable_api_key
        and settings.airtable_base_id
        and settings.airtable_table_id
        and _HAS_PYAIRTABLE
    )


@router.post("/submit", response_model=FeedbackResponse)
async def submit_feedback(
    request: FeedbackRequest, current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Submit feedback to Airtable.

    When Airtable is not configured, returns success with a warning message so UI can still proceed.
    """

    if not request.subject.strip():
        raise HTTPException(status_code=400, detail="Subject is required")
    if not request.comments.strip():
        raise HTTPException(status_code=400, detail="Comments are required")

    # If Airtable not configured, short‑circuit (helpful for dev / tests)
    if not _airtable_available():
        return FeedbackResponse(
            success=True,
            message="Feedback received (Airtable not configured)",
            record_id=None,
            meta={"persisted": False, "airtable": False},
        )

    try:
        # Import only when needed
        from pyairtable import Table as _Table  # type: ignore

        # pyairtable.Table signature: Table(api_key, base_id, table_name)
        table = _Table(  # type: ignore[call-arg]
            settings.airtable_api_key,  # type: ignore[arg-type]
            settings.airtable_base_id,  # type: ignore[arg-type]
            settings.airtable_table_id,  # type: ignore[arg-type] (we pass the table ID which is accepted as name)
        )
        # Build Airtable fields using configured field IDs if present; fallback to field names.
        # (pyairtable docs use field NAMES. Field IDs also work; we support both.)
        fields: Dict[str, Any] = {}

        subj_key = settings.airtable_field_subject_id or "Subject"
        comments_key = settings.airtable_field_comments_id or "Comments"
        reply_key = settings.airtable_field_reply_to_id or "Reply to"

        fields[subj_key] = request.subject
        fields[comments_key] = request.comments
        email_value = (request.email or current_user.get("email") or "").strip()
        if email_value:
            fields[reply_key] = email_value

        # Minimal create (avoid adding unspecified columns to prevent UNKNOWN_FIELD_NAME)
        record = table.create(fields)  # type: ignore[operator]
        record_id = record.get("id") if isinstance(record, dict) else None

        return FeedbackResponse(
            success=True,
            message="Feedback submitted",
            record_id=record_id,
            meta={
                "persisted": True,
                "airtable": True,
                "used_keys": list(fields.keys()),
            },
        )
    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover - network / library errors
        # Fail softly: return success false with informative message instead of 500
        return FeedbackResponse(
            success=False,
            message=f"Feedback not persisted (Airtable error: {e})",
            record_id=None,
            meta={"persisted": False, "airtable": True, "error": str(e)},
        )
