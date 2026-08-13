"""Workspace-level SQL query and Derived Data Block creation route."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, Security, status
from fastapi.responses import JSONResponse

from ...models.workspace import WorkspaceNodeInfo
from ...models.workspace_sql import (
    WorkspaceSqlCreateRequest,
    WorkspaceSqlQueryRequest,
    WorkspaceSqlRequest,
)
from ...runtime import Runtime, get_runtime
from ...services.sessions import SessionPrincipal
from ..responses import api_errors, route_path, workspace_etag
from ..security import get_current_session
from ..table_responses import ARROW_STREAM_RESPONSE, arrow_page_response

router = APIRouter(
    prefix="/workspaces/{workspace_id}",
    tags=["workspaces"],
    responses=api_errors(401),
)


@router.post(
    "/sql",
    response_class=Response,
    response_model=None,
    responses={
        **api_errors(400, 403, 404, 409, 413, 422, 507),
        **ARROW_STREAM_RESPONSE,
        status.HTTP_201_CREATED: {
            "description": "SQL-derived Data Block",
            "model": WorkspaceNodeInfo,
        },
    },
)
async def execute_workspace_sql(
    workspace_id: uuid.UUID,
    command: WorkspaceSqlRequest,
    http_request: Request,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> Response:
    """Query declared Data Blocks or create one SQL-derived Data Block."""

    if isinstance(command, WorkspaceSqlQueryRequest):
        page, revision = await runtime.workspace_sql_service.query(
            principal.user.id,
            str(workspace_id),
            command,
        )
        result = arrow_page_response(page)
        result.headers["ETag"] = workspace_etag(revision)
        return result

    assert isinstance(command, WorkspaceSqlCreateRequest)
    node, revision = await runtime.workspace_sql_service.create(
        principal.user.id,
        str(workspace_id),
        command,
    )
    return JSONResponse(
        status_code=status.HTTP_201_CREATED,
        content=node.model_dump(mode="json"),
        headers={
            "Location": route_path(
                http_request,
                "get_node",
                workspace_id=workspace_id,
                node_id=node.id,
            ),
            "ETag": workspace_etag(revision),
        },
    )


__all__ = ["router"]
