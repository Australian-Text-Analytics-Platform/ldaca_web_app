"""Test-only construction for the production unlimited storage policy."""

from __future__ import annotations

from pathlib import Path

import anyio

from ldaca_wordflow.services.quota import QuotaService
from ldaca_wordflow.services.storage_admission import StorageAdmissionService


class _UnlimitedQuotaRepository:
    async def get_storage_quota_bytes(self, user_id: str) -> None:
        del user_id
        return None


def unlimited_storage_admission(
    root: Path,
    *,
    limiter: anyio.CapacityLimiter | None = None,
    min_free_disk_bytes: int = 0,
) -> StorageAdmissionService:
    """Build the real no-quota policy without a test-only production fallback."""

    root.mkdir(parents=True, exist_ok=True)
    io_limiter = limiter or anyio.CapacityLimiter(4)
    quota = QuotaService(
        _UnlimitedQuotaRepository(),
        data_root=root,
        user_root=lambda user_id: root / "users" / user_id,
        workspaces_root=root / "workspaces",
        limiter=io_limiter,
    )
    return StorageAdmissionService(
        root,
        quota,
        min_free_disk_bytes=min_free_disk_bytes,
        limiter=io_limiter,
    )
