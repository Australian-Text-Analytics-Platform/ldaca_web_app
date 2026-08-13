"""LDaCA Data Portal reads and process-isolated import execution."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from pathlib import Path

import anyio
import httpx
from pydantic import SecretStr

from ..domain import (
    DataPortalUserFileImportRequest,
    DataPortalUserFileImportResult,
)
from ..shared.errors import (
    BadGatewayError,
    InternalServiceError,
    InvalidInputError,
    ResourceTooLargeError,
)
from ..infrastructure.providers.oni import OniClient, extract_ldaca_identifier
from ..models.data_sources import (
    DataPortalImportSubmitRequest,
    DataPortalRecord,
    DataPortalSearchRequest,
    DataPortalSearchResource,
)
from ..settings import Settings
from ..workers.data_portal import data_portal_import_process
from ..infrastructure.storage.layout import validate_display_name
from .user_files import UserFileStore
from .user_file_import_execution_types import UserFileImportKey
from .user_file_import_executor import UserFileImportProcessExecutor
from .provider_credentials import ProviderCredentialStore

ProgressReporter = Callable[[object], Awaitable[None]]


@dataclass(frozen=True, slots=True)
class DataPortalImportExecution:
    function: Callable[..., object]
    kwargs: Mapping[str, object]
    staging: Path


class DataPortalService:
    """Own the configured portal boundary without workspace or API dependencies."""

    def __init__(
        self,
        settings: Settings,
        files: UserFileStore,
        credentials: ProviderCredentialStore,
    ) -> None:
        self._settings = settings
        self._files = files
        self._credentials = credentials
        self._http_client = httpx.AsyncClient(
            base_url=settings.ldaca_oni_api_base_url.rstrip("/"),
            timeout=settings.ldaca_oni_timeout,
            follow_redirects=True,
        )

    async def close(self) -> None:
        """Close the runtime-owned portal connection pool."""

        await self._http_client.aclose()

    async def search(
        self, request: DataPortalSearchRequest
    ) -> DataPortalSearchResource:
        """Run a normalized portal search with one-based API pagination."""

        client = self._client(
            await self._credentials.data_portal_credential(
                supplied=request.api_token,
            )
        )
        try:
            records, total = await client.search(
                method=request.method,
                query=request.query,
                limit=request.page_size,
                offset=(request.page - 1) * request.page_size,
            )
        except (httpx.HTTPError, ValueError) as exc:
            raise BadGatewayError("Data Portal search failed") from exc
        return DataPortalSearchResource(
            page=request.page,
            page_size=request.page_size,
            total=total,
            items=[DataPortalRecord.model_validate(record) for record in records],
        )

    async def featured(
        self,
        api_token: SecretStr | None,
    ) -> DataPortalSearchResource:
        """Read configured featured collections outside all workspace gates."""

        client = self._client(
            await self._credentials.data_portal_credential(supplied=api_token)
        )
        try:
            records = await client.featured_collections(
                list(self._settings.ldaca_oni_featured_collection_ids)
            )
        except (httpx.HTTPError, ValueError) as exc:
            raise BadGatewayError("Data Portal featured collections failed") from exc
        items = [DataPortalRecord.model_validate(record) for record in records]
        return DataPortalSearchResource(
            page=1,
            page_size=max(1, len(items)),
            total=len(items),
            items=items,
        )

    async def prepare_import(
        self,
        user_id: str,
        import_id: str,
        request: DataPortalImportSubmitRequest,
    ) -> tuple[DataPortalUserFileImportRequest, DataPortalImportExecution]:
        """Normalize one request and build its process-private invocation."""

        identifier = extract_ldaca_identifier(request.identifier)
        if identifier is None:
            raise InvalidInputError(
                "Data Portal import requires an ARCP identifier or portal URL"
            )
        if request.name is not None:
            valid, reason = validate_display_name(request.name)
            if not valid:
                raise InvalidInputError(f"Invalid import name: {reason}")
        staging = await self._files.prepare_import_staging(user_id, import_id)
        try:
            api_token = await self._credentials.data_portal_credential(
                supplied=request.api_token,
            )
            name = request.name.strip() if request.name else None
            return (
                DataPortalUserFileImportRequest(
                    identifier=identifier,
                    name=name,
                ),
                DataPortalImportExecution(
                    function=data_portal_import_process,
                    kwargs={
                        "identifier": identifier,
                        "requested_name": name,
                        "api_base_url": self._settings.ldaca_oni_api_base_url,
                        "api_token": api_token,
                        "timeout": self._settings.ldaca_oni_timeout,
                        "download_concurrency": (
                            self._settings.ldaca_oni_download_concurrency
                        ),
                        "staging_dir": str(staging),
                        "max_output_bytes": (
                            self._settings.max_user_file_import_bytes
                        ),
                    },
                    staging=staging,
                ),
            )
        except BaseException:
            with anyio.CancelScope(shield=True):
                await self._files.cleanup_import_staging(user_id, import_id)
            raise

    async def execute_import(
        self,
        key: UserFileImportKey,
        execution: DataPortalImportExecution,
        executor: UserFileImportProcessExecutor,
        report_progress: ProgressReporter,
    ) -> DataPortalUserFileImportResult:
        result = await executor.execute(
            key,
            execution.function,
            execution.kwargs,
            report_progress,
            storage_roots=(str(execution.staging),),
            max_storage_bytes=self._settings.max_user_file_import_bytes,
            max_storage_files=self._settings.max_user_file_import_files,
        )
        if not isinstance(result, dict):
            raise InternalServiceError("Portal import worker returned invalid output")
        validated = DataPortalUserFileImportResult.model_validate(result)
        if validated.bytes_written > self._settings.max_user_file_import_bytes:
            raise ResourceTooLargeError(
                "Data Portal import exceeds the import storage limit"
            )
        return validated

    async def publish_import(
        self,
        user_id: str,
        import_id: str,
        result: DataPortalUserFileImportResult,
    ) -> None:
        installed = await self._files.install_import_staging(
            user_id,
            import_id,
            result.destination_path,
        )
        if installed != result.destination_path:
            raise RuntimeError("Portal import installed at an unexpected path")

    async def cleanup_import(
        self,
        user_id: str,
        import_id: str,
    ) -> None:
        await self._files.cleanup_import_staging(user_id, import_id)

    def _client(self, token: str | None) -> OniClient:
        return OniClient(
            self._http_client,
            token=token,
        )


__all__ = ["DataPortalImportExecution", "DataPortalService"]
