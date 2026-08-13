"""Unified event stream registration, isolation, overflow, and logout."""

import uuid

import anyio

from ldaca_wordflow.domain.background import BackgroundState, Progress
from ldaca_wordflow.domain.events import EventResourceType
from ldaca_wordflow.services.events import EventHub


async def test_stream_ready_is_first_and_publication_is_user_scoped() -> None:
    hub = EventHub(subscriber_queue_size=3)
    alice = await hub.subscribe("alice", "alice-session")
    bob = await hub.subscribe("bob", "bob-session")

    alice_ready = await alice.receive()
    bob_ready = await bob.receive()
    assert alice_ready is not None and alice_ready.type == "stream_ready"
    assert bob_ready is not None and bob_ready.type == "stream_ready"

    resource_id = uuid.uuid4()
    progress = Progress(fraction=0.5, message="Halfway")
    await hub.publish_changed(
        "alice",
        EventResourceType.USER_FILE_IMPORT,
        resource_id,
        revision=2,
        state=BackgroundState.RUNNING,
        progress=progress,
    )
    event = await alice.receive()

    assert event is not None
    assert event.type == "resource_changed"
    assert event.resource_id == resource_id
    assert event.revision == 2
    with anyio.move_on_after(0.01) as scope:
        await bob.receive()
    assert scope.cancel_called
    await hub.close()


async def test_slow_subscriber_receives_only_resync_after_overflow() -> None:
    hub = EventHub(subscriber_queue_size=2)
    subscription = await hub.subscribe("alice", "session")
    resource_id = uuid.uuid4()

    await hub.publish_progress(
        "alice",
        EventResourceType.USER_FILE_IMPORT,
        resource_id,
        Progress(fraction=0.1, message="Started"),
    )
    await hub.publish_progress(
        "alice",
        EventResourceType.USER_FILE_IMPORT,
        resource_id,
        Progress(fraction=0.2, message="Working"),
    )

    event = await subscription.receive()
    assert event is not None
    assert event.type == "resync_required"
    assert subscription.closed is True
    assert await subscription.receive() is None


async def test_logout_closes_only_its_session_streams() -> None:
    hub = EventHub()
    first = await hub.subscribe("alice", "first")
    second = await hub.subscribe("alice", "second")
    await first.receive()
    await second.receive()
    await hub.publish_workspace_runtime("alice", uuid.uuid4(), "open")

    await hub.close_session_streams("first")

    assert await first.receive() is None
    assert second.closed is False
    await hub.close()
