"""Framework-neutral recursive JSON value type shared across layers."""

from __future__ import annotations


type JsonData = str | int | float | bool | None | list[JsonData] | dict[str, JsonData]


__all__ = ["JsonData"]
