"""Workspace-owned Analysis forest, collection, and lifecycle routes."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response, Security, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, TypeAdapter
from starlette.background import BackgroundTask

from ...domain.workspace import Analysis, CorruptAnalysis
from ...models.analysis_results import (
    AnalysisResult,
    AnalysisResultQuery,
    ArtifactResource,
    CompleteTableIdentity,
    PagedTableIdentity,
    ProjectedTableIdentity,
    ConcordanceDensityResult,
    ConcordanceDocumentProjectionQuery,
    QuotationPreviewQuery,
    StoredArtifactIdentity,
)
from ...models.tables import (
    CompleteTableResource,
    PagedTableResource,
    ProjectedTableResource,
    TableProjectionResource,
)
from ...models.analyses import AnalysisCreate, AnalysisPage
from ...runtime import Runtime, get_runtime
from ...services.analysis_results import ResultMaterialization
from ...services.sessions import SessionPrincipal
from ...shared.errors import InternalServiceError
from ...shared.json_data import JsonData
from ..responses import api_errors, route_path
from ..security import get_current_session
from ..table_responses import (
    ARROW_STREAM_RESPONSE,
    arrow_page_response,
    arrow_stream_response,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}",
    tags=["analyses"],
    responses=api_errors(401),
)
_RESULT_ADAPTER = TypeAdapter(AnalysisResult)


def _present_typed_value(
    value: object,
    request: Request,
    workspace_id: uuid.UUID,
    analysis_id: uuid.UUID,
) -> JsonData:
    if isinstance(value, CompleteTableIdentity):
        return CompleteTableResource(
            table_id=value.table_id,
            url=route_path(
                request,
                "download_analysis_table",
                workspace_id=workspace_id,
                analysis_id=analysis_id,
                table_id=value.table_id,
            ),
        ).model_dump(mode="json")
    if isinstance(value, PagedTableIdentity):
        return PagedTableResource(
            table_id=value.table_id,
            schema_url=route_path(
                request,
                "get_analysis_table_schema",
                workspace_id=workspace_id,
                analysis_id=analysis_id,
                table_id=value.table_id,
            ),
            rows_url=route_path(
                request,
                "get_analysis_table_rows",
                workspace_id=workspace_id,
                analysis_id=analysis_id,
                table_id=value.table_id,
            ),
        ).model_dump(mode="json")
    if isinstance(value, ProjectedTableIdentity):
        def projection(row_unit: str) -> TableProjectionResource:
            return TableProjectionResource(
                schema_url=route_path(
                    request,
                    "get_analysis_table_projection_schema",
                    workspace_id=workspace_id,
                    analysis_id=analysis_id,
                    table_id=value.table_id,
                    row_unit=row_unit,
                ),
                rows_url=route_path(
                    request,
                    "get_analysis_table_projection_rows",
                    workspace_id=workspace_id,
                    analysis_id=analysis_id,
                    table_id=value.table_id,
                    row_unit=row_unit,
                ),
            )

        return ProjectedTableResource(
            table_id=value.table_id,
            documents=projection("documents"),
            matches=projection("matches"),
            density_url=(
                route_path(
                    request,
                    "get_concordance_table_density",
                    workspace_id=workspace_id,
                    analysis_id=analysis_id,
                    table_id=value.table_id,
                )
                if value.supports_density
                else None
            ),
        ).model_dump(mode="json")
    if isinstance(value, StoredArtifactIdentity):
        return ArtifactResource(
            name=value.name,
            media_type=value.media_type,
            url=route_path(
                request,
                "download_analysis_artifact",
                workspace_id=workspace_id,
                analysis_id=analysis_id,
                artifact_name=value.name,
            ),
        ).model_dump(mode="json")
    if isinstance(value, BaseModel):
        return {
            name: _present_typed_value(
                child,
                request,
                workspace_id,
                analysis_id,
            )
            for name, child in value
        }
    if isinstance(value, dict):
        return {
            str(key): _present_typed_value(
                child,
                request,
                workspace_id,
                analysis_id,
            )
            for key, child in value.items()
        }
    if isinstance(value, list):
        return [
            _present_typed_value(child, request, workspace_id, analysis_id)
            for child in value
        ]
    if isinstance(value, uuid.UUID):
        return str(value)
    if value is None or isinstance(value, str | int | float | bool):
        return value
    raise InternalServiceError("Stored Analysis Result is invalid")


def _present_result(
    value: ResultMaterialization,
    request: Request,
    workspace_id: uuid.UUID,
    analysis_id: uuid.UUID,
) -> AnalysisResult:
    payload = dict(value.payload)
    stored = _present_typed_value(
        value.stored,
        request,
        workspace_id,
        analysis_id,
    )
    if isinstance(stored, dict):
        for key in (
            "artifacts",
            "tables",
            "table",
            "result_type",
            "source",
            "sources",
        ):
            if key in stored:
                payload[key] = stored[key]
    return _RESULT_ADAPTER.validate_python(payload)


@router.post(
    "/tabs/{tab_id}/analyses",
    response_model=Analysis,
    status_code=status.HTTP_201_CREATED,
    responses=api_errors(403, 404, 409, 422, 500, 507),
)
async def submit_tab_analysis(
    workspace_id: uuid.UUID,
    tab_id: uuid.UUID,
    body: AnalysisCreate,
    request: Request,
    response: Response,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> Analysis:
    """Create one complete immutable Analysis in a Tab-owned forest."""

    analysis = await runtime.analysis_service.submit(
        principal.user.id,
        str(workspace_id),
        str(tab_id),
        body,
    )
    response.headers["Location"] = route_path(
        request,
        "get_analysis",
        workspace_id=workspace_id,
        analysis_id=analysis.id,
    )
    return analysis


@router.get(
    "/tabs/{tab_id}/analyses",
    response_model=list[Analysis | CorruptAnalysis],
    responses=api_errors(403, 404, 422, 500),
)
async def list_tab_analyses(
    workspace_id: uuid.UUID,
    tab_id: uuid.UUID,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> list[Analysis | CorruptAnalysis]:
    """Return a Tab's complete Analysis forest in creation order."""

    return await runtime.analysis_service.for_tab(
        principal.user.id,
        str(workspace_id),
        str(tab_id),
    )


@router.delete(
    "/tabs/{tab_id}/analyses",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=api_errors(403, 404, 409, 422, 500, 507),
)
async def clear_tab_analysis(
    workspace_id: uuid.UUID,
    tab_id: uuid.UUID,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> Response:
    """Clear the Tab's complete Analysis forest."""

    await runtime.analysis_service.clear_tab(
        principal.user.id,
        str(workspace_id),
        str(tab_id),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/analyses",
    response_model=AnalysisPage,
    responses=api_errors(403, 404, 409, 422, 500),
)
async def list_analyses(
    workspace_id: uuid.UUID,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    runtime: Runtime = Depends(get_runtime),
) -> AnalysisPage:
    """Return one stable page of live valid and corrupt Analyses."""

    return await runtime.analysis_service.list_analyses(
        principal.user.id,
        str(workspace_id),
        page=page,
        page_size=page_size,
    )


@router.get(
    "/analyses/{analysis_id}",
    response_model=Analysis,
    responses=api_errors(403, 404, 409, 422, 500),
)
async def get_analysis(
    workspace_id: uuid.UUID,
    analysis_id: uuid.UUID,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> Analysis:
    """Return one valid live Analysis by its Workspace-local identity."""

    return await runtime.analysis_service.get(
        principal.user.id,
        str(workspace_id),
        str(analysis_id),
    )


@router.post(
    "/analyses/{analysis_id}/cancel",
    response_model=Analysis,
    responses={
        **api_errors(403, 404, 409, 422, 500),
        status.HTTP_202_ACCEPTED: {
            "model": Analysis,
            "description": "Process termination remains pending",
        },
    },
)
async def cancel_analysis(
    workspace_id: uuid.UUID,
    analysis_id: uuid.UUID,
    response: Response,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> Analysis:
    """Cancel queued work or request termination of one running Analysis."""

    analysis, pending = await runtime.analysis_service.cancel(
        principal.user.id,
        str(workspace_id),
        str(analysis_id),
    )
    if pending:
        response.status_code = status.HTTP_202_ACCEPTED
    return analysis


@router.get(
    "/analyses/{analysis_id}/result",
    response_model=AnalysisResult,
    responses=api_errors(403, 404, 409, 410, 413, 422, 500, 507),
)
async def get_analysis_result(
    workspace_id: uuid.UUID,
    analysis_id: uuid.UUID,
    request: Request,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> AnalysisResult:
    """Return the canonical first page of one successful Analysis Result."""

    value = await runtime.analysis_result_service.query(
        principal.user.id,
        str(workspace_id),
        str(analysis_id),
        None,
        allow_closing=True,
    )
    return _present_result(value, request, workspace_id, analysis_id)


@router.post(
    "/analyses/{analysis_id}/result/query",
    response_model=AnalysisResult,
    responses=api_errors(400, 403, 404, 409, 410, 413, 422, 500, 507),
)
async def query_analysis_result(
    workspace_id: uuid.UUID,
    analysis_id: uuid.UUID,
    body: AnalysisResultQuery,
    request: Request,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> AnalysisResult:
    """Apply one complete typed, side-effect-free Result projection."""

    value = await runtime.analysis_result_service.query(
        principal.user.id,
        str(workspace_id),
        str(analysis_id),
        body,
        allow_closing=False,
    )
    return _present_result(value, request, workspace_id, analysis_id)


@router.post(
    "/analyses/{analysis_id}/result/tables/quotation-preview/query",
    response_class=Response,
    responses={
        **api_errors(400, 403, 404, 409, 410, 413, 422, 500, 507),
        **ARROW_STREAM_RESPONSE,
    },
)
async def query_quotation_preview_table(
    workspace_id: uuid.UUID,
    analysis_id: uuid.UUID,
    body: QuotationPreviewQuery,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> Response:
    """Compute one Quotation Preview document page as Arrow IPC."""

    result = await runtime.analysis_result_service.quotation_preview_page(
        principal.user.id,
        str(workspace_id),
        str(analysis_id),
        body,
    )
    return arrow_page_response(result)


@router.get(
    "/analyses/{analysis_id}/result/tables/{table_id}",
    response_class=FileResponse,
    responses={
        **api_errors(403, 404, 409, 410, 413, 422, 500, 507),
        status.HTTP_200_OK: {
            "content": {
                "application/vnd.apache.arrow.stream": {
                    "schema": {"type": "string", "format": "binary"}
                }
            },
            "description": "Complete Arrow IPC Result table",
        },
    },
)
async def download_analysis_table(
    workspace_id: uuid.UUID,
    analysis_id: uuid.UUID,
    table_id: str,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> FileResponse:
    """Return one complete immutable Result table as an Arrow IPC stream."""

    snapshot = await runtime.analysis_result_service.table_response_snapshot(
        principal.user.id,
        str(workspace_id),
        str(analysis_id),
        table_id,
    )
    return FileResponse(
        snapshot.path,
        media_type="application/vnd.apache.arrow.stream",
        headers={"Cache-Control": "no-store"},
        background=BackgroundTask(snapshot.cleanup),
    )


@router.get(
    "/analyses/{analysis_id}/result/tables/{table_id}/rows",
    response_class=Response,
    responses={
        **api_errors(403, 404, 409, 410, 422, 500, 507),
        **ARROW_STREAM_RESPONSE,
    },
)
async def get_analysis_table_rows(
    workspace_id: uuid.UUID,
    analysis_id: uuid.UUID,
    table_id: str,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=500)] = 50,
    sort_by: str | None = None,
    descending: bool = False,
) -> Response:
    """Return one page of an open-ended Result table as Arrow IPC."""

    result = await runtime.analysis_result_service.paged_table_page(
        principal.user.id,
        str(workspace_id),
        str(analysis_id),
        table_id,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        descending=descending,
    )
    return arrow_page_response(result)


@router.get(
    "/analyses/{analysis_id}/result/tables/{table_id}/schema",
    response_class=Response,
    responses={
        **api_errors(403, 404, 409, 410, 422, 500, 507),
        **ARROW_STREAM_RESPONSE,
    },
)
async def get_analysis_table_schema(
    workspace_id: uuid.UUID,
    analysis_id: uuid.UUID,
    table_id: str,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> Response:
    """Return a paged Result table schema as a zero-row Arrow stream."""

    content = await runtime.analysis_result_service.paged_table_schema(
        principal.user.id,
        str(workspace_id),
        str(analysis_id),
        table_id,
    )
    return arrow_stream_response(content)


@router.get(
    "/analyses/{analysis_id}/result/tables/{table_id}/projections/{row_unit}/rows",
    response_class=Response,
    responses={
        **api_errors(403, 404, 409, 410, 422, 500, 507),
        **ARROW_STREAM_RESPONSE,
    },
)
async def get_analysis_table_projection_rows(
    workspace_id: uuid.UUID,
    analysis_id: uuid.UUID,
    table_id: str,
    row_unit: Literal["documents", "matches"],
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=500)] = 50,
    sort_by: str | None = None,
    descending: bool = False,
) -> Response:
    result = await runtime.analysis_result_service.projected_table_page(
        principal.user.id,
        str(workspace_id),
        str(analysis_id),
        table_id,
        row_unit=row_unit,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        descending=descending,
    )
    return arrow_page_response(result)


@router.post(
    "/analyses/{analysis_id}/result/tables/{table_id}/projections/documents/query",
    response_class=Response,
    responses={
        **api_errors(403, 404, 409, 410, 422, 500, 507),
        **ARROW_STREAM_RESPONSE,
    },
)
async def query_concordance_document_projection(
    workspace_id: uuid.UUID,
    analysis_id: uuid.UUID,
    table_id: str,
    body: ConcordanceDocumentProjectionQuery,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> Response:
    """Filter and page document rows from one immutable Concordance Result."""

    result = await runtime.analysis_result_service.concordance_document_projection_page(
        principal.user.id,
        str(workspace_id),
        str(analysis_id),
        table_id,
        body,
    )
    return arrow_page_response(result)


@router.get(
    "/analyses/{analysis_id}/result/tables/{table_id}/projections/{row_unit}/schema",
    response_class=Response,
    responses={
        **api_errors(403, 404, 409, 410, 422, 500, 507),
        **ARROW_STREAM_RESPONSE,
    },
)
async def get_analysis_table_projection_schema(
    workspace_id: uuid.UUID,
    analysis_id: uuid.UUID,
    table_id: str,
    row_unit: Literal["documents", "matches"],
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> Response:
    content = await runtime.analysis_result_service.projected_table_schema(
        principal.user.id,
        str(workspace_id),
        str(analysis_id),
        table_id,
        row_unit=row_unit,
    )
    return arrow_stream_response(content)


@router.get(
    "/analyses/{analysis_id}/result/tables/{table_id}/density",
    response_model=ConcordanceDensityResult,
    responses=api_errors(403, 404, 409, 410, 422, 500, 507),
)
async def get_concordance_table_density(
    workspace_id: uuid.UUID,
    analysis_id: uuid.UUID,
    table_id: str,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> ConcordanceDensityResult:
    return await runtime.analysis_result_service.concordance_density(
        principal.user.id,
        str(workspace_id),
        str(analysis_id),
        table_id,
    )


@router.get(
    "/analyses/{analysis_id}/artifacts/{artifact_name}",
    response_class=FileResponse,
    responses={
        **api_errors(403, 404, 409, 410, 413, 422, 500, 507),
        status.HTTP_200_OK: {
            "content": {
                "application/octet-stream": {
                    "schema": {"type": "string", "format": "binary"}
                }
            },
            "description": "Analysis Artifact",
        },
    },
)
async def download_analysis_artifact(
    workspace_id: uuid.UUID,
    analysis_id: uuid.UUID,
    artifact_name: str,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> FileResponse:
    """Download one declared Artifact through a response-lifetime snapshot."""

    (
        snapshot,
        reference,
    ) = await runtime.analysis_result_service.artifact_response_snapshot(
        principal.user.id,
        str(workspace_id),
        str(analysis_id),
        artifact_name,
    )
    return FileResponse(
        snapshot.path,
        filename=reference.name,
        media_type=reference.media_type or "application/octet-stream",
        background=BackgroundTask(snapshot.cleanup),
    )


__all__ = ["router"]
