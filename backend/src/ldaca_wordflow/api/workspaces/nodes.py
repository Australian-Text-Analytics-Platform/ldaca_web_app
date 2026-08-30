"""Canonical workspace node resource and row-query routes."""

from __future__ import annotations

import uuid

from fastapi import (
    APIRouter,
    Query,
    Request,
    Response,
    status,
)
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ...models.node_resources import (
    DataBlockExportRequest,
    NodeCreateRequest,
    NodeDerivationRequest,
    NodeEditRequest,
    NodeUpdateRequest,
)
from ...models.workspace import DataBlockResource, WorkspaceNodeInfo
from ..dependencies import RuntimeDep
from ..security import CurrentSessionSecurityDep
from ..responses import api_errors, route_path, workspace_etag
from ..table_responses import (
    ARROW_STREAM_RESPONSE,
    arrow_page_response,
    arrow_stream_response,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/nodes",
    tags=["nodes"],
    responses=api_errors(401),
)


@router.get(
    "",
    response_model=list[DataBlockResource],
    responses=api_errors(403, 404, 409, 422),
)
async def list_nodes(
    workspace_id: uuid.UUID,
    response: Response,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> list[DataBlockResource]:
    """Return every Data Block in the persisted graph order."""

    nodes, revision = await runtime.node_service.list_nodes(
        principal.user.id,
        workspace_id,
    )
    response.headers["ETag"] = workspace_etag(revision)
    return nodes


@router.post(
    "/exports",
    response_class=FileResponse,
    responses={
        **api_errors(403, 404, 409, 413, 422, 507),
        status.HTTP_200_OK: {
            "content": {
                "text/csv": {"schema": {"type": "string", "format": "binary"}},
                "application/json": {"schema": {"type": "string", "format": "binary"}},
                "application/x-ndjson": {
                    "schema": {"type": "string", "format": "binary"}
                },
                "application/vnd.apache.parquet": {
                    "schema": {"type": "string", "format": "binary"}
                },
                "application/vnd.apache.arrow.file": {
                    "schema": {"type": "string", "format": "binary"}
                },
                "application/zip": {"schema": {"type": "string", "format": "binary"}},
            },
            "description": "One Data Block file or a ZIP containing multiple files",
        },
    },
)
async def export_data_blocks(
    workspace_id: uuid.UUID,
    request: DataBlockExportRequest,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> FileResponse:
    """Return selected Data Blocks as one file or a server-built ZIP."""

    (
        snapshot,
        filename,
        media_type,
        revision,
    ) = await runtime.data_block_export_service.export(
        principal.user.id,
        workspace_id,
        request,
    )
    return FileResponse(
        snapshot.path,
        filename=filename,
        media_type=media_type,
        headers={"ETag": workspace_etag(revision)},
        background=BackgroundTask(snapshot.cleanup),
    )


@router.post(
    "",
    response_model=WorkspaceNodeInfo,
    status_code=status.HTTP_201_CREATED,
    responses=api_errors(400, 403, 404, 409, 413, 422, 507),
)
async def create_node(
    workspace_id: uuid.UUID,
    request: NodeCreateRequest,
    http_request: Request,
    response: Response,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> WorkspaceNodeInfo:
    """Create one file-backed source or immutable derived Data Block."""

    node, revision = await runtime.node_service.create(
        principal.user.id,
        workspace_id,
        request,
    )
    response.headers["Location"] = route_path(
        http_request,
        "get_node",
        workspace_id=workspace_id,
        node_id=node.id,
    )
    response.headers["ETag"] = workspace_etag(revision)
    return node


@router.post(
    "/previews",
    response_class=Response,
    responses={**api_errors(400, 403, 404, 413, 422), **ARROW_STREAM_RESPONSE},
)
async def preview_node_creation(
    workspace_id: uuid.UUID,
    request: NodeDerivationRequest,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
) -> Response:
    """Preview a derived-node plan without changing workspace state."""

    rows, revision = await runtime.node_service.preview(
        principal.user.id,
        workspace_id,
        request,
        page=page,
        page_size=page_size,
    )
    result = arrow_page_response(rows)
    result.headers["ETag"] = workspace_etag(revision)
    return result


@router.get(
    "/{node_id}",
    response_model=DataBlockResource,
    responses=api_errors(404, 422),
)
async def get_node(
    workspace_id: uuid.UUID,
    node_id: uuid.UUID,
    response: Response,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> DataBlockResource:
    """Return one node's schema and topology metadata."""

    node, revision = await runtime.node_service.get(
        principal.user.id,
        workspace_id,
        node_id,
    )
    response.headers["ETag"] = workspace_etag(revision)
    return node


@router.patch(
    "/{node_id}",
    response_model=WorkspaceNodeInfo,
    responses=api_errors(400, 403, 404, 409, 422, 507),
)
async def update_node(
    workspace_id: uuid.UUID,
    node_id: uuid.UUID,
    request: NodeUpdateRequest,
    response: Response,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> WorkspaceNodeInfo:
    """Update one node's public metadata and return the committed resource."""

    node, revision = await runtime.node_service.update(
        principal.user.id,
        workspace_id,
        node_id,
        request,
    )
    response.headers["ETag"] = workspace_etag(revision)
    return node


@router.post(
    "/{node_id}/edits",
    response_model=WorkspaceNodeInfo,
    responses=api_errors(400, 403, 404, 409, 422, 507),
)
async def edit_node(
    workspace_id: uuid.UUID,
    node_id: uuid.UUID,
    request: NodeEditRequest,
    response: Response,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> WorkspaceNodeInfo:
    """Apply one identity-preserving Data Block Edit."""

    node, revision = await runtime.node_service.edit(
        principal.user.id,
        workspace_id,
        node_id,
        request,
    )
    response.headers["ETag"] = workspace_etag(revision)
    return node


@router.post(
    "/{node_id}/undo",
    response_model=WorkspaceNodeInfo,
    responses=api_errors(403, 404, 409, 422, 507),
)
async def undo_node(
    workspace_id: uuid.UUID,
    node_id: uuid.UUID,
    response: Response,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> WorkspaceNodeInfo:
    """Restore the Data Block's previous session plan."""

    node, revision = await runtime.node_service.undo(
        principal.user.id,
        workspace_id,
        node_id,
    )
    response.headers["ETag"] = workspace_etag(revision)
    return node


@router.post(
    "/{node_id}/redo",
    response_model=WorkspaceNodeInfo,
    responses=api_errors(403, 404, 409, 422, 507),
)
async def redo_node(
    workspace_id: uuid.UUID,
    node_id: uuid.UUID,
    response: Response,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> WorkspaceNodeInfo:
    """Restore the Data Block's next session plan."""

    node, revision = await runtime.node_service.redo(
        principal.user.id,
        workspace_id,
        node_id,
    )
    response.headers["ETag"] = workspace_etag(revision)
    return node


@router.delete(
    "/{node_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=api_errors(400, 403, 404, 409, 422, 507),
)
async def delete_node(
    workspace_id: uuid.UUID,
    node_id: uuid.UUID,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> Response:
    """Delete one node under the workspace gate and return an empty body."""

    revision = await runtime.node_service.delete(
        principal.user.id,
        workspace_id,
        node_id,
    )
    return Response(
        status_code=status.HTTP_204_NO_CONTENT,
        headers={"ETag": workspace_etag(revision)},
    )


@router.get(
    "/{node_id}/schema",
    response_class=Response,
    responses={**api_errors(404, 422), **ARROW_STREAM_RESPONSE},
)
async def get_node_schema(
    workspace_id: uuid.UUID,
    node_id: uuid.UUID,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> Response:
    """Return the Data Block schema as a zero-row Arrow IPC stream."""

    content, revision = await runtime.node_service.schema(
        principal.user.id,
        workspace_id,
        node_id,
    )
    result = arrow_stream_response(content)
    result.headers["ETag"] = workspace_etag(revision)
    return result
