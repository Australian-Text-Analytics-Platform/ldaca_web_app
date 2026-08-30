"""Remote sample catalogue reads and integrity-checked import execution."""

from __future__ import annotations

import os
import hashlib
import hmac
import tempfile
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import TypeVar
from urllib.parse import quote

import anyio
import httpx
from anyio.to_thread import run_sync as run_sync_in_worker_thread
from pydantic import ValidationError

from ..domain import SampleUserFileImportResult
from ..domain.background import Progress
from ..infrastructure.storage.durable_fs import (
    fsync_directory as _fsync_directory,
    fsync_file as _fsync_file,
)
from ..models.data_sources import (
    SampleCatalogueResource,
    SampleCollection,
    sample_destination_path,
)
from ..shared.errors import (
    BadGatewayError,
    InvalidInputError,
    ResourceConflictError,
    ResourceTooLargeError,
)
from .user_files import UserFileStore

SAMPLE_DATA_REMOTE_BASE_URL = (
    "https://raw.githubusercontent.com/"
    "Australian-Text-Analytics-Platform/ldaca-analytics-sample-data/main/"
)

T = TypeVar("T")


@dataclass(frozen=True, slots=True)
class SampleImportExecution:
    """Validated catalogue snapshot and private staging for one live import."""

    collection: SampleCollection
    staging: Path


class SampleDataService:
    """Own remote sample I/O and atomic per-collection installation."""

    def __init__(
        self,
        files: UserFileStore,
        *,
        limiter: anyio.CapacityLimiter,
        max_import_bytes: int,
        max_import_files: int,
    ) -> None:
        self._files = files
        self._limiter = limiter
        self._max_import_bytes = max_import_bytes
        self._max_import_files = max_import_files
        self._client = httpx.AsyncClient(
            base_url=SAMPLE_DATA_REMOTE_BASE_URL,
            timeout=httpx.Timeout(30.0),
            follow_redirects=False,
        )

    async def close(self) -> None:
        """Close the lifespan-owned HTTP connection pool."""

        await self._client.aclose()

    async def catalogue(self, user_id: str) -> SampleCatalogueResource:
        """Fetch the remote catalogue and attach current-user installation state."""

        catalogue = await self._fetch_catalogue()
        paths = {
            collection.id: f"sample_data/{collection.id}"
            for collection in catalogue.collections
        }
        existing = await self._files.existing_directories(user_id, list(paths.values()))
        installed = {
            collection_id for collection_id, path in paths.items() if path in existing
        }
        return catalogue.model_copy(
            update={
                "collections": [
                    collection.model_copy(
                        update={"installed": collection.id in installed}
                    )
                    for collection in catalogue.collections
                ]
            }
        )

    async def prepare_import(
        self,
        user_id: str,
        collection_id: str,
        import_id: str,
    ) -> SampleImportExecution:
        """Snapshot one importable collection and allocate its private stage."""

        catalogue = await self.catalogue(user_id)
        collection = next(
            (item for item in catalogue.collections if item.id == collection_id),
            None,
        )
        if collection is None:
            raise InvalidInputError("Sample collection does not exist")
        if collection.installed:
            raise ResourceConflictError("Sample collection is already installed")
        if collection.total_size_bytes > self._max_import_bytes:
            raise ResourceTooLargeError(
                "Sample collection exceeds the import storage limit"
            )
        if len(collection.files) > self._max_import_files:
            raise ResourceTooLargeError(
                "Sample collection exceeds the import file limit"
            )
        staging = await self._files.prepare_import_staging(user_id, import_id)
        return SampleImportExecution(collection, staging)

    async def _fetch_catalogue(self) -> SampleCatalogueResource:
        try:
            response = await self._client.get("catalogue.json")
            response.raise_for_status()
            return SampleCatalogueResource.model_validate(response.json())
        except (httpx.HTTPError, ValueError, ValidationError) as exc:
            raise BadGatewayError("Sample catalogue is unavailable") from exc

    async def execute_import(
        self,
        execution: SampleImportExecution,
        report_progress: Callable[[Progress], Awaitable[None]],
    ) -> SampleUserFileImportResult:
        """Download one complete remote collection into private staging."""

        collection = execution.collection
        total_bytes = 0
        for index, entry in enumerate(collection.files):
            relative = Path(*sample_destination_path(collection.id, entry.path).parts)
            destination = execution.staging / relative
            await self._run_io(_ensure_directory, destination.parent)
            downloaded = await self._download(
                entry.path,
                destination,
                entry.size,
                entry.sha256,
            )
            total_bytes += downloaded
            await report_progress(
                Progress(
                    fraction=(0.95 * (index + 1)) / max(1, len(collection.files)),
                    message=(
                        f"Imported {index + 1} of {len(collection.files)} sample files"
                    ),
                )
            )
        if total_bytes != collection.total_size_bytes:
            raise BadGatewayError("Sample collection integrity check failed")
        return SampleUserFileImportResult(
            collection_id=collection.id,
            destination_path=f"sample_data/{collection.id}",
            file_count=len(collection.files),
            bytes_written=total_bytes,
        )

    async def _download(
        self,
        remote_path: str,
        destination: Path,
        expected_size: int,
        expected_sha256: str,
    ) -> int:
        temporary = await self._run_io(_new_download_path, destination)
        bytes_written = 0
        digest = hashlib.sha256()
        try:
            async with self._client.stream(
                "GET",
                quote(remote_path, safe="/"),
            ) as response:
                response.raise_for_status()
                async with await anyio.open_file(temporary, "wb") as handle:
                    async for chunk in response.aiter_bytes(1024 * 1024):
                        bytes_written += len(chunk)
                        if bytes_written > expected_size:
                            raise BadGatewayError("Sample file integrity check failed")
                        digest.update(chunk)
                        await handle.write(chunk)
            if bytes_written != expected_size:
                raise BadGatewayError("Sample file size does not match the catalogue")
            if not hmac.compare_digest(digest.hexdigest(), expected_sha256):
                raise BadGatewayError("Sample file digest does not match the catalogue")
            await self._run_io(_publish_download, temporary, destination)
            return bytes_written
        except httpx.HTTPError as exc:
            raise BadGatewayError("Sample file download failed") from exc
        finally:
            with anyio.CancelScope(shield=True):
                await self._run_io(_unlink_if_present, temporary)

    async def publish_import(
        self,
        user_id: str,
        import_id: str,
        result: SampleUserFileImportResult,
    ) -> None:
        installed = await self._files.install_import_staging(
            user_id,
            import_id,
            result.destination_path,
        )
        if installed != result.destination_path:
            raise RuntimeError("Sample import installed at an unexpected path")

    async def cleanup_import(self, user_id: str, import_id: str) -> None:
        await self._files.cleanup_import_staging(user_id, import_id)

    async def is_import_published(
        self,
        user_id: str,
        import_id: str,
        result: SampleUserFileImportResult,
    ) -> bool:
        return await self._files.is_import_published(
            user_id,
            import_id,
            result.destination_path,
        )

    async def _run_io(
        self,
        function: Callable[..., T],
        *args: object,
    ) -> T:
        return await run_sync_in_worker_thread(
            partial(function, *args),
            abandon_on_cancel=False,
            limiter=self._limiter,
        )


def _publish_download(temporary: Path, destination: Path) -> None:
    _fsync_file(temporary)
    os.replace(temporary, destination)
    _fsync_directory(destination.parent)


def _new_download_path(destination: Path) -> Path:
    descriptor, raw_temporary = tempfile.mkstemp(
        prefix=f".{destination.name}.",
        suffix=".download",
        dir=destination.parent,
    )
    os.close(descriptor)
    return Path(raw_temporary)


def _ensure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _unlink_if_present(path: Path) -> None:
    path.unlink(missing_ok=True)


__all__ = ["SampleDataService", "SampleImportExecution"]
