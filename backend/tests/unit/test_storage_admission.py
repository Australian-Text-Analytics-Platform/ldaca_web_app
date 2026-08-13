"""Guard quota accounting, physical admission, and response snapshots."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import anyio
import pytest

from ldaca_wordflow.infrastructure.storage.workspace_access import (
    write_workspace_owner,
)
from ldaca_wordflow.services import quota as quota_module
from ldaca_wordflow.services import response_snapshots as response_snapshots_module
from ldaca_wordflow.services.quota import (
    QuotaService,
    QuotaStorageStatus,
    UnlimitedStorageStatus,
)
from ldaca_wordflow.services.response_snapshots import ResponseSnapshotService
from ldaca_wordflow.services.storage_admission import StorageAdmissionService
from ldaca_wordflow.shared.errors import (
    StorageCapacityExceededError,
    StorageQuotaExceededError,
)

from ._storage import unlimited_storage_admission

_ALLOCATION_UNIT = 4096


@dataclass(slots=True)
class _QuotaRepository:
    limits: dict[str, int | None] = field(default_factory=dict)

    async def get_storage_quota_bytes(self, user_id: str) -> int | None:
        return self.limits.get(user_id)


def _quota_service(
    root: Path,
    repository: _QuotaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> QuotaService:
    root.mkdir(parents=True)
    monkeypatch.setattr(
        quota_module,
        "_probe_allocation_unit",
        lambda _root: _ALLOCATION_UNIT,
    )
    monkeypatch.setattr(
        quota_module,
        "_entry_allocated_bytes",
        lambda metadata, unit: max(
            ((metadata.st_size + unit - 1) // unit) * unit,
            unit,
        ),
    )
    return QuotaService(
        repository,
        data_root=root,
        user_root=lambda user_id: root / "users" / user_id,
        workspaces_root=root / "workspaces",
        limiter=anyio.CapacityLimiter(4),
    )


@pytest.mark.anyio
async def test_unlimited_policy_never_probes_or_scans(tmp_path: Path) -> None:
    """A NULL policy is a true quota no-op in every runtime profile."""

    missing_root = tmp_path / "missing"
    service = QuotaService(
        _QuotaRepository({"user": None}),
        data_root=missing_root,
        user_root=lambda _user_id: (_ for _ in ()).throw(
            AssertionError("unlimited policy scanned user storage")
        ),
        workspaces_root=missing_root / "workspaces",
        limiter=anyio.CapacityLimiter(1),
    )

    await service.initialize(require_finite_capability=False)
    assert await service.status("user") == UnlimitedStorageStatus()
    reservation = await service.reserve("user", 10_000, requested_entries=2)
    await reservation.recheck(10_000)
    await reservation.release()


@pytest.mark.anyio
async def test_finite_status_counts_only_owned_durable_allocation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Live/trash ownership is counted while other owners and staging are not."""

    root = tmp_path / "data"
    repository = _QuotaRepository({"alice": 1_000_000})
    service = _quota_service(root, repository, monkeypatch)

    user_root = root / "users" / "alice"
    (user_root / "files").mkdir(parents=True)
    (user_root / "files" / "document.txt").write_text("alice", encoding="utf-8")

    live = root / "workspaces" / "00000000-0000-0000-0000-000000000001"
    live.mkdir(parents=True)
    write_workspace_owner(live, "alice")
    (live / "workspace.json").write_text("{}", encoding="utf-8")

    other = root / "workspaces" / "00000000-0000-0000-0000-000000000002"
    other.mkdir(parents=True)
    write_workspace_owner(other, "bob")
    (other / "large.bin").write_bytes(b"x" * 100_000)

    staged = root / "workspaces" / ".staging" / "pending"
    staged.mkdir(parents=True)
    write_workspace_owner(staged, "alice")
    (staged / "pending.bin").write_bytes(b"x" * 100_000)

    trashed = root / "workspaces" / ".trash" / "deleted-workspace"
    trashed.mkdir(parents=True)
    write_workspace_owner(trashed, "alice")
    (trashed / "workspace.json").write_text("{}", encoding="utf-8")

    expected = sum(
        [
            await service.measure_path(user_root),
            await service.measure_path(live),
            await service.measure_path(trashed),
        ]
    )
    status = await service.status("alice")

    assert isinstance(status, QuotaStorageStatus)
    limit = repository.limits["alice"]
    assert isinstance(limit, int)
    assert status.used_bytes == expected
    assert status.reserved_bytes == 0
    assert status.available_bytes == limit - expected


@pytest.mark.anyio
async def test_concurrent_reservations_cannot_overcommit_finite_quota(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Every uncommitted reservation participates in the next atomic snapshot."""

    repository = _QuotaRepository({"user": 1_000_000})
    service = _quota_service(tmp_path / "data", repository, monkeypatch)
    baseline = await service.status("user")
    assert isinstance(baseline, QuotaStorageStatus)
    repository.limits["user"] = baseline.used_bytes + 2 * _ALLOCATION_UNIT

    first = await service.reserve("user", 1)
    second = await service.reserve("user", 1)
    try:
        with pytest.raises(StorageQuotaExceededError) as caught:
            await service.reserve("user", 1)
        assert caught.value.details == {
            "limit_bytes": repository.limits["user"],
            "used_bytes": baseline.used_bytes,
            "reserved_bytes": 2 * _ALLOCATION_UNIT,
            "requested_growth_bytes": _ALLOCATION_UNIT,
        }
    finally:
        await second.release()
        await first.release()


@pytest.mark.anyio
async def test_final_recheck_observes_lower_limit_with_zero_new_request(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A committed policy reduction is seen before staged output is published."""

    repository = _QuotaRepository({"user": 1_000_000})
    root = tmp_path / "data"
    service = _quota_service(root, repository, monkeypatch)
    baseline = await service.status("user")
    assert isinstance(baseline, QuotaStorageStatus)
    reservation = await service.reserve("user", 1, requested_entries=1)
    staging = root / ".staging" / "output"
    staging.mkdir(parents=True)
    (staging / "result.bin").write_bytes(b"x")
    actual = await service.measure_path(staging)
    assert actual == reservation.reserved_bytes
    repository.limits["user"] = max(1, baseline.used_bytes)

    try:
        with pytest.raises(StorageQuotaExceededError) as caught:
            await reservation.recheck_path(staging)
        assert caught.value.details == {
            "limit_bytes": repository.limits["user"],
            "used_bytes": baseline.used_bytes,
            "reserved_bytes": actual,
            "requested_growth_bytes": 0,
        }
    finally:
        await reservation.release()


@pytest.mark.anyio
async def test_zero_growth_remains_allowed_after_limit_reduction(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Reads, moves, and non-growing replacement remain legal while over quota."""

    repository = _QuotaRepository({"user": 1_000_000})
    service = _quota_service(tmp_path / "data", repository, monkeypatch)
    reservation = await service.reserve("user", 1)
    repository.limits["user"] = 1

    await reservation.recheck(0)
    await reservation.release()
    status = await service.status("user")
    assert isinstance(status, QuotaStorageStatus)
    assert status.reserved_bytes == 0


@pytest.mark.anyio
async def test_estimated_recheck_observes_newly_finite_policy(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unlimited reservation cannot bypass a finite policy set before commit."""

    repository = _QuotaRepository({"user": None})
    service = _quota_service(tmp_path / "data", repository, monkeypatch)
    reservation = await service.reserve("user", 1, requested_entries=1)
    repository.limits["user"] = _ALLOCATION_UNIT

    try:
        with pytest.raises(StorageQuotaExceededError) as caught:
            await reservation.recheck_estimate(1, requested_entries=1)
        assert caught.value.details == {
            "limit_bytes": _ALLOCATION_UNIT,
            "used_bytes": 0,
            "reserved_bytes": 0,
            "requested_growth_bytes": 2 * _ALLOCATION_UNIT,
        }
    finally:
        await reservation.release()


@pytest.mark.anyio
async def test_quota_precedes_detail_free_physical_capacity_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The caller sees its own limit first and never sees host capacity facts."""

    repository = _QuotaRepository({"user": 1})
    root = tmp_path / "data"
    quota = _quota_service(root, repository, monkeypatch)
    admission = StorageAdmissionService(
        root,
        quota,
        min_free_disk_bytes=10**30,
        limiter=anyio.CapacityLimiter(2),
    )

    with pytest.raises(StorageQuotaExceededError):
        await admission.acquire("user", 1)

    repository.limits["user"] = None
    with pytest.raises(StorageCapacityExceededError) as caught:
        await admission.acquire("user", 1)
    assert caught.value.details is None


@pytest.mark.anyio
async def test_required_allocation_probe_has_no_logical_size_fallback(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Hosted readiness fails instead of silently changing quota semantics."""

    root = tmp_path / "data"
    root.mkdir()
    service = QuotaService(
        _QuotaRepository(),
        data_root=root,
        user_root=lambda user_id: root / "users" / user_id,
        workspaces_root=root / "workspaces",
        limiter=anyio.CapacityLimiter(1),
    )
    monkeypatch.delattr(quota_module.os, "statvfs", raising=False)

    with pytest.raises(
        RuntimeError,
        match="Data Root does not expose filesystem allocation metrics",
    ):
        await service.initialize(require_finite_capability=True)


@pytest.mark.anyio
async def test_transient_reservation_does_not_consume_durable_user_quota(
    tmp_path: Path,
) -> None:
    """Downloads reserve disk headroom without creating a quota reservation."""

    admission = unlimited_storage_admission(tmp_path / "data")
    transient = await admission.acquire_transient(500)
    durable = await admission.acquire("user", 100)
    await durable.release()
    await transient.release()


@pytest.mark.anyio
async def test_response_snapshot_survives_source_deletion_and_cleans_up(
    tmp_path: Path,
) -> None:
    """A response owns an immutable inode until its background cleanup completes."""

    root = tmp_path / "data"
    admission = unlimited_storage_admission(root)
    source = root / "source.bin"
    source.write_bytes(b"snapshot payload")
    service = ResponseSnapshotService(
        root / "responses",
        admission,
        max_snapshot_bytes=1024,
        max_concurrent_snapshots=1,
        limiter=anyio.CapacityLimiter(2),
    )

    snapshot = await service.create(source)
    source.write_bytes(b"mutated source")
    assert snapshot.path.read_bytes() == b"snapshot payload"
    source.unlink()

    response_path = snapshot.path
    await snapshot.cleanup()
    await snapshot.cleanup()
    assert not response_path.exists()


@pytest.mark.anyio
async def test_response_snapshot_reconciliation_propagates_cleanup_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Startup must not hide an abandoned response directory it cannot remove."""

    root = tmp_path / "data"
    snapshot_root = root / "responses"
    snapshot_root.mkdir(parents=True)
    (snapshot_root / "orphan.bin").write_bytes(b"orphan")
    service = ResponseSnapshotService(
        snapshot_root,
        unlimited_storage_admission(root),
        max_snapshot_bytes=1024,
        max_concurrent_snapshots=1,
        limiter=anyio.CapacityLimiter(2),
    )

    def fail_cleanup(_path: Path) -> None:
        raise PermissionError("denied")

    monkeypatch.setattr(response_snapshots_module.shutil, "rmtree", fail_cleanup)

    with pytest.raises(PermissionError, match="denied"):
        await service.reconcile()
