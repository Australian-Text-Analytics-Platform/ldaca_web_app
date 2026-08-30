"""Unified authenticated Server-Sent Event stream."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime

import anyio
from fastapi import APIRouter, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent

from ..services.events import EventHub
from ..services.sessions import SessionPrincipal, SessionService
from .dependencies import RuntimeDep
from .responses import api_errors
from .security import SESSION_COOKIE_NAME, CurrentSessionSecurityDep

router = APIRouter(tags=["events"], responses=api_errors(401))


def _same_session(
    current: SessionPrincipal | None,
    expected: SessionPrincipal,
) -> bool:
    return (
        current is not None
        and current.session_id == expected.session_id
        and current.user.id == expected.user.id
    )


async def _events(
    hub: EventHub,
    sessions: SessionService,
    session_token: str | None,
    principal: SessionPrincipal,
) -> AsyncIterator[ServerSentEvent]:
    """Revalidate session ownership around race-free stream registration."""

    current = await sessions.current_principal(session_token)
    if not _same_session(current, principal):
        return
    subscription = await hub.subscribe(principal.user.id, principal.session_id)
    try:
        current = await sessions.current_principal(session_token)
        if not _same_session(current, principal):
            return
        while True:
            if (
                principal.expires_at is not None
                and datetime.now(UTC) >= principal.expires_at
            ):
                return
            event = None
            wait_seconds = 15.0
            if principal.expires_at is not None:
                wait_seconds = max(
                    0.0,
                    min(
                        wait_seconds,
                        (principal.expires_at - datetime.now(UTC)).total_seconds(),
                    ),
                )
            with anyio.move_on_after(wait_seconds):
                event = await subscription.receive()
            if event is None:
                if subscription.closed:
                    return
                yield ServerSentEvent(comment="heartbeat")
                continue
            yield ServerSentEvent(
                event=event.type,
                data=event,
                id=str(event.sequence),
                retry=1_000 if event.type == "stream_ready" else None,
            )
            if event.type == "resync_required":
                return
    finally:
        await hub.unsubscribe(subscription)


@router.get("/events", response_class=EventSourceResponse)
async def backend_events(
    request: Request,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> AsyncIterator[ServerSentEvent]:
    """Open one bounded stream and refresh authoritative resources after ready."""

    async for event in _events(
        runtime.event_hub,
        runtime.session_service,
        request.cookies.get(SESSION_COOKIE_NAME),
        principal,
    ):
        yield event


__all__ = ["router"]
