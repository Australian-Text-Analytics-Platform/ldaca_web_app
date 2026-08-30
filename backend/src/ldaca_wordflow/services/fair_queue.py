"""Small runtime-only fair-user selector shared by independent schedulers."""

from __future__ import annotations

from collections import deque
from collections.abc import Callable, Iterable
from typing import Any, TypeVar

T = TypeVar("T")


class FairUserQueue[T]:
    """Select per-user FIFO work while rotating users under contention."""

    def __init__(self) -> None:
        self._items: dict[str, list[T]] = {}
        self._user_order: deque[str] = deque()
        self._last_user: str | None = None

    def __bool__(self) -> bool:
        return bool(self._user_order)

    def add(
        self,
        user_id: str,
        item: T,
        *,
        order_key: Callable[[T], Any],
    ) -> None:
        items = self._items.setdefault(user_id, [])
        items.append(item)
        items.sort(key=order_key)
        if user_id not in self._user_order:
            self._user_order.append(user_id)

    def pop(self) -> T:
        if len(self._user_order) > 1 and self._user_order[0] == self._last_user:
            self._user_order.rotate(-1)
        user_id = self._user_order.popleft()
        items = self._items[user_id]
        selected = items.pop(0)
        if items:
            self._user_order.append(user_id)
        else:
            self._items.pop(user_id)
        self._last_user = user_id
        return selected

    def remove(self, user_id: str, predicate: Callable[[T], bool]) -> list[T]:
        items = self._items.get(user_id)
        if items is None:
            return []
        removed = [item for item in items if predicate(item)]
        if not removed:
            return []
        retained = [item for item in items if not predicate(item)]
        if retained:
            self._items[user_id] = retained
        else:
            self._items.pop(user_id)
            self._user_order = deque(
                queued_user
                for queued_user in self._user_order
                if queued_user != user_id
            )
        return removed

    def items_for(self, user_id: str) -> tuple[T, ...]:
        return tuple(self._items.get(user_id, ()))

    def values(self) -> Iterable[T]:
        for items in self._items.values():
            yield from items

    def clear(self) -> list[T]:
        items = list(self.values())
        self._items.clear()
        self._user_order.clear()
        return items


__all__ = ["FairUserQueue"]
