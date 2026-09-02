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


def format_exception_diagnostic(exc: BaseException) -> str:
    """Return the deepest exception type and message without traceback text."""

    current = exc
    seen: set[int] = set()
    while id(current) not in seen:
        seen.add(id(current))
        cause = current.__cause__
        if cause is None and not current.__suppress_context__:
            cause = current.__context__
        if cause is None or id(cause) in seen:
            break
        current = cause
    diagnostic_type = getattr(current, "diagnostic_type", None)
    diagnostic_message = getattr(current, "diagnostic_message", None)
    error_type = (
        diagnostic_type if isinstance(diagnostic_type, str) else type(current).__name__
    )
    message = (
        diagnostic_message
        if isinstance(diagnostic_message, str)
        else str(current)
    )
    return f"{error_type}: {message}" if message else error_type


# ── 400 Bad Request ──────────────────────────────────────────────────────────


class InvalidInputError(AppError):
    status_code = 400
    code = "invalid_input"


class InvalidClusterCountError(AppError):
    status_code = 422
    code = "invalid_topic_cluster_count"


class InvalidTopicTopNError(AppError):
    status_code = 422
    code = "invalid_topic_top_n"


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

    def __init__(self) -> None:
        super().__init__("Storage capacity is unavailable")


class BackendCapacityExceededError(AppError):
    """The hosted process cannot admit more open Workspace state."""

    status_code = 503
    code = "backend_capacity_exceeded"

    def __init__(self) -> None:
        super().__init__("Backend capacity is unavailable")


class BackendStoppingError(AppError):
    """The process has begun lifespan shutdown and admits no new work."""

    status_code = 503
    code = "backend_stopping"

    def __init__(self) -> None:
        super().__init__("Backend is stopping")


class RuntimeUnavailableError(AppError):
    """A data-dependent request arrived while no Runtime was ready."""

    status_code = 503
    code = "runtime_unavailable"

    def __init__(self) -> None:
        super().__init__("The Data Root runtime is not ready")


class DataRootInvalidError(AppError):
    """A proposed Data Root could not pass backend filesystem validation."""

    status_code = 422
    code = "data_root_invalid"

    def __init__(self) -> None:
        super().__init__("Data Root must be an accessible absolute directory")


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


class DataRootManagedByOperatorError(AccessDeniedError):
    """The current deployment profile does not permit browser mutation."""

    code = "data_root_managed_by_operator"

    def __init__(self) -> None:
        super().__init__("Data Root is managed by the deployment operator")


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


class DataRootBusyError(ResourceConflictError):
    """A root switch would interrupt retained background work."""

    code = "data_root_busy"

    def __init__(self) -> None:
        super().__init__("Wait for analyses and imports to finish before switching")


class DataRootTransitionError(ResourceConflictError):
    """Another root transition already owns the process-wide boundary."""

    code = "data_root_transition_in_progress"

    def __init__(self) -> None:
        super().__init__("A Data Root change is already in progress")


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


class WorkspaceInUseError(WorkspaceConflictError):
    """Another backend process owns the target Workspace's open lifetime."""

    code = "workspace_in_use"

    def __init__(self) -> None:
        super().__init__("Workspace is open in another Wordflow backend process")


class WorkspaceCorruptError(AppError):
    """An owned Workspace folder cannot be read as the current strict schema."""

    status_code = 500
    code = "workspace_corrupt"


class AnalysisCorruptError(AppError):
    """A live Workspace-owned Analysis record cannot be validated."""

    status_code = 500
    code = "analysis_corrupt"


class UserFileImportCorruptError(AppError):
    """One user's retained import records cannot be strictly reconstructed."""

    status_code = 500
    code = "user_file_import_corrupt"


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


class DataRootInitializationError(InternalServiceError):
    """A user-selected Data Root failed while constructing its Runtime."""

    code = "data_root_initialization_failed"


class WorkspaceLockUnavailableError(AppError):
    """The backend cannot safely establish Workspace process ownership."""

    status_code = 500
    code = "workspace_lock_unavailable"

    def __init__(self) -> None:
        super().__init__("Workspace locking is unavailable")


# ── 502 Bad Gateway ──────────────────────────────────────────────────────────


class BadGatewayError(AppError):
    status_code = 502
    code = "bad_gateway"


class AnnotationProviderError(BadGatewayError):
    """Expose one stable provider-failure category with its diagnostic.

    Used by synchronous model discovery and Preview services after the provider
    adapter has classified an SDK exception. The original exception remains in
    the cause chain so the HTTP boundary can expose its deepest type and message.
    """

    def __init__(
        self,
        code: str,
        message: str,
        *,
        provider: str | None = None,
        model: str | None = None,
    ) -> None:
        self.code = code
        self.provider = provider
        self.model = model
        super().__init__(message)


class UserPreferencesCorruptError(AppError):
    """One user's canonical preference file cannot be validated."""

    status_code = 500
    code = "user_preferences_corrupt"

    def __init__(self) -> None:
        super().__init__(
            "User preferences are unavailable because their stored file is invalid"
        )


class ProviderCredentialsCorruptError(AppError):
    """One user's canonical provider credential file cannot be validated."""

    status_code = 500
    code = "provider_credentials_corrupt"

    def __init__(self) -> None:
        super().__init__(
            "Provider credentials are unavailable because their stored file is invalid"
        )


class ProviderCredentialMissingError(ResourceConflictError):
    """A provider operation requires a credential that is not configured."""

    code = "provider_credential_missing"
