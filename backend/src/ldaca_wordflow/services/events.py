"""Bounded boot-local delivery for user-scoped resource refresh events."""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

import anyio

from ..domain.background import BackgroundState, Progress
from ..domain.events import (
    BackendEvent,
    EventResourceType,
    ResourceChangedEvent,
    ResourceProgressEvent,
    ResourceRemovedEvent,
    ResyncRequiredEvent,
    StreamReadyEvent,
    WorkspaceRuntimeChangedEvent,
)


class EventSubscription:
    """Receive-only handle for one bounded session-owned stream."""

    def __init__(self, maxsize: int) -> None:
        self._queue: asyncio.Queue[BackendEvent | None] = asyncio.Queue(
            maxsize=maxsize
        )
        self.closed = False

    async def receive(self) -> BackendEvent | None:
        if self.closed and self._queue.empty():
            return None
        return await self._queue.get()


@dataclass(slots=True)
class _Subscriber:
    id: uuid.UUID
    user_id: str
    session_id: str
    subscription: EventSubscription


class EventHub:
    """Publish hints only; REST resources remain the authoritative read model."""

    def __init__(self, *, subscriber_queue_size: int = 256) -> None:
        if subscriber_queue_size < 1:
            raise ValueError("Event subscriber queue size must be positive")
        self._subscriber_queue_size = subscriber_queue_size
        self._subscribers: dict[uuid.UUID, _Subscriber] = {}
        self._sequence = 0
        self._lock = anyio.Lock()
        self._closed = False

    async def subscribe(
        self,
        user_id: str,
        session_id: str,
    ) -> EventSubscription:
        """Register first, then enqueue stream_ready under the same lock."""

        async with self._lock:
            if self._closed:
                raise RuntimeError("Event hub is closed")
            subscription = EventSubscription(self._subscriber_queue_size)
            subscriber = _Subscriber(
                uuid.uuid4(),
                user_id,
                session_id,
                subscription,
            )
            self._subscribers[subscriber.id] = subscriber
            subscription._queue.put_nowait(
                StreamReadyEvent(
                    sequence=self._next_sequence(),
                    occurred_at=datetime.now(UTC),
                )
            )
            return subscription

    async def unsubscribe(self, subscription: EventSubscription) -> None:
        async with self._lock:
            self._remove_subscription(subscription)
            self._close_subscription(subscription)

    async def close_session_streams(self, session_id: str) -> None:
        async with self._lock:
            matches = [
                subscriber
                for subscriber in self._subscribers.values()
                if subscriber.session_id == session_id
            ]
            for subscriber in matches:
                self._subscribers.pop(subscriber.id, None)
                self._close_subscription(subscriber.subscription)

    async def publish_changed(
        self,
        user_id: str,
        resource_type: EventResourceType,
        resource_id: uuid.UUID,
        *,
        revision: int,
        workspace_id: uuid.UUID | None = None,
        state: BackgroundState | None = None,
        progress: Progress | None = None,
    ) -> None:
        async with self._lock:
            event = ResourceChangedEvent(
                sequence=self._next_sequence(),
                occurred_at=datetime.now(UTC),
                resource_type=resource_type,
                resource_id=resource_id,
                workspace_id=workspace_id,
                state=state,
                progress=progress,
                revision=revision,
            )
            self._publish_locked(user_id, event)

    async def publish_removed(
        self,
        user_id: str,
        resource_type: EventResourceType,
        resource_id: uuid.UUID,
        *,
        workspace_id: uuid.UUID | None = None,
        revision: int | None = None,
    ) -> None:
        async with self._lock:
            event = ResourceRemovedEvent(
                sequence=self._next_sequence(),
                occurred_at=datetime.now(UTC),
                resource_type=resource_type,
                resource_id=resource_id,
                workspace_id=workspace_id,
                revision=revision,
            )
            self._publish_locked(user_id, event)

    async def publish_progress(
        self,
        user_id: str,
        resource_type: Literal[
            EventResourceType.ANALYSIS,
            EventResourceType.USER_FILE_IMPORT,
        ],
        resource_id: uuid.UUID,
        progress: Progress,
        *,
        workspace_id: uuid.UUID | None = None,
    ) -> None:
        async with self._lock:
            event = ResourceProgressEvent(
                sequence=self._next_sequence(),
                occurred_at=datetime.now(UTC),
                resource_type=resource_type,
                resource_id=resource_id,
                workspace_id=workspace_id,
                progress=progress,
            )
            self._publish_locked(user_id, event)

    async def publish_workspace_runtime(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
        runtime_state: Literal["closed", "open", "closing"],
    ) -> None:
        async with self._lock:
            event = WorkspaceRuntimeChangedEvent(
                sequence=self._next_sequence(),
                occurred_at=datetime.now(UTC),
                resource_id=workspace_id,
                workspace_id=workspace_id,
                runtime_state=runtime_state,
            )
            self._publish_locked(user_id, event)

    async def close(self) -> None:
        async with self._lock:
            if self._closed:
                return
            self._closed = True
            subscriptions = [
                subscriber.subscription for subscriber in self._subscribers.values()
            ]
            self._subscribers.clear()
            for subscription in subscriptions:
                self._close_subscription(subscription)

    def _publish_locked(self, user_id: str, event: BackendEvent) -> None:
        for subscriber in list(self._subscribers.values()):
            if subscriber.user_id != user_id:
                continue
            queue = subscriber.subscription._queue
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait(
                    ResyncRequiredEvent(
                        sequence=self._next_sequence(),
                        occurred_at=datetime.now(UTC),
                    )
                )
                subscriber.subscription.closed = True
                self._subscribers.pop(subscriber.id, None)

    def _remove_subscription(self, subscription: EventSubscription) -> None:
        for subscriber_id, subscriber in list(self._subscribers.items()):
            if subscriber.subscription is subscription:
                self._subscribers.pop(subscriber_id, None)

    @staticmethod
    def _close_subscription(subscription: EventSubscription) -> None:
        if subscription.closed:
            return
        subscription.closed = True
        queue = subscription._queue
        while not queue.empty():
            queue.get_nowait()
        queue.put_nowait(None)

    def _next_sequence(self) -> int:
        self._sequence += 1
        return self._sequence


__all__ = ["EventHub", "EventSubscription"]
