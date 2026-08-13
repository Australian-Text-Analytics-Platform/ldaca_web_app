"""Framework-neutral application and domain-facing error hierarchy.

Used by:
- Route handlers, process entrypoints, and backend services.

Flow:
- Module defines a framework-neutral base ``AppError`` with explicit
  ``status_code`` and ``code`` class attributes and subclasses for each semantic error
  category.
- The FastAPI boundary converts every ``AppError`` into ``ApiError``.
"""

from __future__ import annotations

from .json_data import JsonData


class AppError(Exception):
    """Framework-neutral domain failure mapped at the HTTP boundary.

    Subclasses set ``status_code`` as a class attribute.
    """

    status_code: int = 500
    code: str = "internal_error"
    expose_message: bool = False

    def __init__(
        self,
        detail: str | dict[str, JsonData] | None = None,
        *,
        details: dict[str, JsonData] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        if isinstance(detail, dict):
            message_value = detail.get("message") or detail.get("detail") or self.code
            inferred_details = {
                key: value
                for key, value in detail.items()
                if key not in {"message", "detail"}
            }
            self.message = str(message_value)
            self.details = (
                details if details is not None else (inferred_details or None)
            )
        else:
            self.message = str(detail) if detail is not None else self.code
            self.details = details
        self.headers = headers or {}
        super().__init__(self.message)


# ── 400 Bad Request ──────────────────────────────────────────────────────────


class InvalidInputError(AppError):
    status_code = 400
    code = "invalid_input"


class UnsafePathError(InvalidInputError):
    """A user-controlled path is not a safe relative storage path.

    Used by:
    - file and workspace-archive services before reading or writing beneath a
      user-owned storage root.

    Why:
    - callers need a stable code for traversal, platform-specific absolute
      paths, symlink/reparse-point components, and containment races without
      exposing the rejected host path.
    """

    code = "unsafe_path"


class UploadTooLargeError(AppError):
    """An upload exceeded the configured byte limit while being streamed."""

    status_code = 413
    code = "upload_too_large"


class ResourceTooLargeError(AppError):
    """A stored resource is too large for the requested eager operation."""

    status_code = 413
    code = "resource_too_large"


class UserFileTreeTooLargeError(ResourceTooLargeError):
    """The complete User File tree exceeds the response safety boundary."""

    code = "user_file_tree_too_large"


class UnsupportedMediaTypeError(AppError):
    """A request body uses a media type outside the route's exact contract."""

    status_code = 415
    code = "unsupported_media_type"


class StorageQuotaExceededError(AppError):
    """One principal's finite durable allocation would be exceeded."""

    status_code = 507
    code = "storage_quota_exceeded"
    expose_message = True

    def __init__(
        self,
        *,
        limit_bytes: int,
        used_bytes: int,
        reserved_bytes: int,
        requested_growth_bytes: int,
    ) -> None:
        super().__init__(
            "Storage quota exceeded",
            details={
                "limit_bytes": limit_bytes,
                "used_bytes": used_bytes,
                "reserved_bytes": reserved_bytes,
                "requested_growth_bytes": requested_growth_bytes,
            },
        )


class StorageCapacityExceededError(AppError):
    """The shared Data Root cannot preserve its physical safety reserve."""

    status_code = 507
    code = "storage_capacity_exceeded"
    expose_message = True

    def __init__(self) -> None:
        super().__init__("Storage capacity is unavailable")


class BackendCapacityExceededError(AppError):
    """The hosted process cannot admit more open Workspace state."""

    status_code = 503
    code = "backend_capacity_exceeded"
    expose_message = True

    def __init__(self) -> None:
        super().__init__("Backend capacity is unavailable")


class BackendStoppingError(AppError):
    """The process has begun lifespan shutdown and admits no new work."""

    status_code = 503
    code = "backend_stopping"
    expose_message = True

    def __init__(self) -> None:
        super().__init__("Backend is stopping")


class InvalidWorkspaceArchiveError(InvalidInputError):
    """A workspace ZIP failed structural or bounded-extraction validation."""

    code = "invalid_workspace_archive"


# ── 401 Unauthorised ─────────────────────────────────────────────────────────


class UnauthenticatedError(AppError):
    status_code = 401
    code = "unauthenticated"


# ── 403 Forbidden ────────────────────────────────────────────────────────────


class AccessDeniedError(AppError):
    status_code = 403
    code = "access_denied"


# ── 404 Not Found ────────────────────────────────────────────────────────────


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


class WorkspaceNotFoundError(AppError):
    status_code = 404
    code = "workspace_not_found"


class NodeNotFoundError(AppError):
    status_code = 404
    code = "node_not_found"


class TabNotFoundError(AppError):
    status_code = 404
    code = "tab_not_found"


class AnalysisNotFoundError(AppError):
    status_code = 404
    code = "analysis_not_found"


class UserFileImportNotFoundError(AppError):
    status_code = 404
    code = "user_file_import_not_found"


class FileNotFoundError(AppError):  # noqa: A001 (shadows builtin on purpose)
    status_code = 404
    code = "file_not_found"


# ── 409 Conflict ─────────────────────────────────────────────────────────────


class ResourceConflictError(AppError):
    status_code = 409
    code = "resource_conflict"


class WorkspaceConflictError(ResourceConflictError):
    """The caller attempted to persist an obsolete workspace revision.

    Raised by:
    - ``WorkspaceService`` before mutation or persistence so concurrent requests
      cannot silently overwrite a newer workspace state.
    """

    code = "workspace_conflict"


class WorkspaceNotOpenError(WorkspaceConflictError):
    """A child or mutation operation targeted a closed Workspace."""

    code = "workspace_not_open"


class WorkspaceClosingError(WorkspaceConflictError):
    """A new mutation or work request targeted a draining Workspace."""

    code = "workspace_closing"


class WorkspaceCorruptError(AppError):
    """An owned Workspace folder cannot be read as the current strict schema."""

    status_code = 500
    code = "workspace_corrupt"
    expose_message = True


class TabCorruptError(AppError):
    """A Workspace-referenced strict Tab record cannot be loaded."""

    status_code = 500
    code = "tab_corrupt"
    expose_message = True


class AnalysisCorruptError(AppError):
    """A live Workspace-owned Analysis record cannot be validated."""

    status_code = 500
    code = "analysis_corrupt"
    expose_message = True


class UserFileImportCorruptError(AppError):
    """One user's retained import records cannot be strictly reconstructed."""

    status_code = 500
    code = "user_file_import_corrupt"
    expose_message = True


class AnalysisKindMismatchError(ResourceConflictError):
    code = "analysis_kind_mismatch"


class AnalysisInputMissingError(ResourceConflictError):
    code = "analysis_input_missing"


class TabAnalysisExistsError(ResourceConflictError):
    code = "tab_analysis_exists"


class AnalysisParentInvalidError(ResourceConflictError):
    code = "analysis_parent_invalid"


class AnalysisNotCancellableError(ResourceConflictError):
    code = "analysis_not_cancellable"


class UserFileImportNotCancellableError(ResourceConflictError):
    code = "user_file_import_not_cancellable"


class UserFileImportNotTerminalError(ResourceConflictError):
    code = "user_file_import_not_terminal"


class AnalysisNotSucceededError(ResourceConflictError):
    """A Result was requested before its Analysis successfully completed."""

    code = "analysis_not_succeeded"


class DataBlockInUseError(ResourceConflictError):
    """A Data Block mutation intersects an active Analysis reservation."""

    code = "data_block_in_use"


# ── 410 Gone ─────────────────────────────────────────────────────────────────


class ArtifactGoneError(AppError):
    """A declared retained Artifact is no longer available."""

    status_code = 410
    code = "artifact_gone"


class AnalysisInputGoneError(AppError):
    """A completed Analysis is unusable because a required input is absent."""

    status_code = 410
    code = "analysis_input_missing"


class AnalysisResultUnavailableError(AppError):
    """A retained input needed to query a completed Result is unavailable."""

    status_code = 410
    code = "analysis_result_unavailable"


# ── 500 Internal Server Error ────────────────────────────────────────────────


class InternalServiceError(AppError):
    status_code = 500
    code = "internal_service_error"


# ── 502 Bad Gateway ──────────────────────────────────────────────────────────


class BadGatewayError(AppError):
    status_code = 502
    code = "bad_gateway"


class AnnotationProviderError(BadGatewayError):
    """Expose one fixed provider-failure category without leaking SDK details.

    Used by synchronous model discovery and Preview services after the provider
    adapter has classified an SDK exception. The original exception remains in
    the cause chain for correlated backend logging, while only this stable code
    and safe message cross the HTTP boundary.
    """

    expose_message = True

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


class UserPreferencesCorruptError(AppError):
    """One user's canonical preference file cannot be validated."""

    status_code = 500
    code = "user_preferences_corrupt"
    expose_message = True

    def __init__(self) -> None:
        super().__init__(
            "User preferences are unavailable because their stored file is invalid"
        )


class ProviderCredentialsCorruptError(AppError):
    """One user's canonical provider credential file cannot be validated."""

    status_code = 500
    code = "provider_credentials_corrupt"
    expose_message = True

    def __init__(self) -> None:
        super().__init__(
            "Provider credentials are unavailable because their stored file is invalid"
        )


class ProviderCredentialMissingError(ResourceConflictError):
    """A provider operation requires a credential that is not configured."""

    code = "provider_credential_missing"
