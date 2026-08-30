"""Shared private TOML persistence safety and publication tests."""

from __future__ import annotations

import stat
from dataclasses import dataclass
from pathlib import Path

import anyio
import pytest

from ldaca_wordflow.infrastructure.storage.private_toml import (
    MAX_PRIVATE_TOML_BYTES,
    PrivateTomlError,
    PrivateTomlPersistence,
)


@dataclass
class _Reservation:
    fail_recheck: bool = False
    staged_path: Path | None = None
    replacing_path: Path | None = None
    released: bool = False

    async def recheck_path(
        self,
        staged_path: Path,
        *,
        replacing_path: Path | None = None,
    ) -> int:
        self.staged_path = staged_path
        self.replacing_path = replacing_path
        if self.fail_recheck:
            raise RuntimeError("recheck failed")
        return staged_path.stat().st_size

    async def release(self) -> None:
        self.released = True


class _Admission:
    def __init__(self, *, fail_recheck: bool = False) -> None:
        self.reservation = _Reservation(fail_recheck=fail_recheck)
        self.request: tuple[str, int, int] | None = None

    async def acquire(
        self,
        user_id: str,
        requested_bytes: int,
        *,
        requested_entries: int = 0,
    ) -> _Reservation:
        self.request = (user_id, requested_bytes, requested_entries)
        return self.reservation


def _persistence(tmp_path: Path, admission: _Admission) -> PrivateTomlPersistence:
    return PrivateTomlPersistence(
        tmp_path / "users",
        admission,
        limiter=anyio.CapacityLimiter(2),
    )


@pytest.mark.anyio
async def test_private_toml_is_bounded_admitted_private_and_round_trips(
    tmp_path: Path,
) -> None:
    admission = _Admission()
    persistence = _persistence(tmp_path, admission)

    await persistence.write("user-a", "preferences.toml", {"schema_version": 2})

    path = tmp_path / "users" / "user-a" / "preferences.toml"
    assert admission.request is not None
    assert admission.request[0] == "user-a"
    assert admission.request[1] == path.stat().st_size
    assert admission.request[2] == 1
    assert admission.reservation.staged_path is not None
    assert admission.reservation.replacing_path is None
    assert admission.reservation.released is True
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert await persistence.read("user-a", "preferences.toml") == {
        "schema_version": 2
    }


@pytest.mark.anyio
async def test_failed_admission_recheck_keeps_existing_toml(
    tmp_path: Path,
) -> None:
    initial_admission = _Admission()
    await _persistence(tmp_path, initial_admission).write(
        "user-a",
        "preferences.toml",
        {"schema_version": 2},
    )
    failing_admission = _Admission(fail_recheck=True)
    persistence = _persistence(tmp_path, failing_admission)

    with pytest.raises(RuntimeError, match="recheck failed"):
        await persistence.write(
            "user-a",
            "preferences.toml",
            {"schema_version": 3},
        )

    assert await persistence.read("user-a", "preferences.toml") == {
        "schema_version": 2
    }
    assert failing_admission.reservation.replacing_path == (
        tmp_path / "users" / "user-a" / "preferences.toml"
    )
    assert failing_admission.reservation.released is True
    assert not list((tmp_path / "users" / "user-a").glob("*.upload"))


@pytest.mark.anyio
async def test_oversized_private_toml_is_rejected_before_decoding(
    tmp_path: Path,
) -> None:
    admission = _Admission()
    persistence = _persistence(tmp_path, admission)
    path = tmp_path / "users" / "user-a" / "preferences.toml"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"x" * (MAX_PRIVATE_TOML_BYTES + 1))

    with pytest.raises(PrivateTomlError, match="byte limit"):
        await persistence.read("user-a", "preferences.toml")
