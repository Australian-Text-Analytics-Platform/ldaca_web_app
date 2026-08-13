"""Shared selector semantics without scheduler lifecycle coupling."""

from ldaca_wordflow.services.fair_queue import FairUserQueue


def test_one_user_can_fill_capacity_while_users_rotate_under_contention() -> None:
    queue = FairUserQueue[tuple[str, int]]()
    queue.add("alice", ("a2", 2), order_key=lambda item: item[1])
    queue.add("alice", ("a1", 1), order_key=lambda item: item[1])

    assert queue.pop() == ("a1", 1)

    queue.add("bob", ("b1", 1), order_key=lambda item: item[1])
    assert queue.pop() == ("b1", 1)
    assert queue.pop() == ("a2", 2)


def test_removal_and_clear_preserve_other_users() -> None:
    queue = FairUserQueue[str]()
    queue.add("alice", "remove", order_key=lambda item: item)
    queue.add("alice", "retain", order_key=lambda item: item)
    queue.add("bob", "other", order_key=lambda item: item)

    assert queue.remove("alice", lambda item: item == "remove") == ["remove"]
    assert set(queue.clear()) == {"retain", "other"}
    assert not queue
