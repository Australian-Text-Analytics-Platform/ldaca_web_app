"""Workspace-scoped lazy Polars SQL queries and Derived Data Block creation."""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any, TypeVar

import anyio
import polars as pl
from anyio.to_thread import run_sync as run_sync_in_worker_thread

from ..domain.workspace import (
    DerivationInput,
    DerivationProvenance,
    Node,
    SqlDerivation,
    Workspace,
    node_reference,
)
from ..infrastructure.storage.layout import validate_display_name
from ..models.workspace import WorkspaceNodeInfo
from ..models.workspace_sql import (
    WorkspaceSqlCreateRequest,
    WorkspaceSqlQueryRequest,
)
from ..shared.errors import InvalidInputError, NodeNotFoundError
from ..shared.table_transport import IpcTablePage, materialize_page
from .node_projection import canonical_node_info
from .workspace import WorkspaceService

T = TypeVar("T")
_EXTERNAL_READER = re.compile(r"^(?:read|scan)_[A-Za-z0-9_]*$", re.IGNORECASE)


class WorkspaceSqlService:
    """Execute SQL against only the Data Blocks declared by one command."""

    def __init__(
        self,
        workspaces: WorkspaceService,
        *,
        io_limiter: anyio.CapacityLimiter,
    ) -> None:
        self._workspaces = workspaces
        self._io_limiter = io_limiter

    async def query(
        self,
        user_id: str,
        workspace_id: str,
        request: WorkspaceSqlQueryRequest,
    ) -> tuple[IpcTablePage, int]:
        async with self._workspaces.read_context(user_id, workspace_id) as lease:
            inputs = _resolve_inputs(lease.workspace, request.node_ids)
            page = await self._run_io(
                _query_page,
                inputs,
                request.sql,
                request.page,
                request.page_size,
            )
            return page, lease.revision

    async def create(
        self,
        user_id: str,
        workspace_id: str,
        request: WorkspaceSqlCreateRequest,
    ) -> tuple[WorkspaceNodeInfo, int]:
        async with self._workspaces.mutation_context(
            user_id,
            workspace_id,
        ) as lease:
            inputs = _resolve_inputs(lease.workspace, request.node_ids)
            node = await self._run_io(
                _create_sql_node,
                lease.workspace,
                inputs,
                request.sql,
                request.name,
            )
            info = await self._run_io(canonical_node_info, node)
        return WorkspaceNodeInfo.model_validate(info), lease.revision

    async def _run_io(
        self,
        function: Callable[..., T],
        *args: Any,
    ) -> T:
        return await run_sync_in_worker_thread(
            function,
            *args,
            abandon_on_cancel=False,
            limiter=self._io_limiter,
        )


def _resolve_inputs(
    workspace: Workspace,
    node_ids: list[Any],
) -> list[Node]:
    inputs: list[Node] = []
    for raw_node_id in node_ids:
        node_id = str(raw_node_id)
        node = workspace.nodes.get(node_id)
        if node is None:
            raise NodeNotFoundError("Node not found")
        inputs.append(node)
    return inputs


def _query_page(
    inputs: list[Node],
    sql: str,
    page: int,
    page_size: int,
) -> IpcTablePage:
    lazyframe = _execute_sql(inputs, sql)
    try:
        return materialize_page(lazyframe, page=page, page_size=page_size)
    except pl.exceptions.PolarsError as exc:
        raise InvalidInputError(str(exc)) from exc


def _create_sql_node(
    workspace: Workspace,
    inputs: list[Node],
    sql: str,
    name: str,
) -> Node:
    normalized_name = name.strip()
    valid, reason = validate_display_name(normalized_name)
    if not valid:
        raise InvalidInputError(f"Invalid node name: {reason}")

    lazyframe = _execute_sql(inputs, sql)
    try:
        lazyframe.collect_schema()
        serialized = lazyframe.serialize(format="binary")
    except pl.exceptions.PolarsError as exc:
        raise InvalidInputError(str(exc)) from exc
    if not isinstance(serialized, bytes):  # pragma: no cover - Polars contract guard
        raise TypeError("LazyFrame serialization did not return bytes")

    node = Node(
        data=lazyframe,
        name=normalized_name,
        parents=inputs,
        provenance=DerivationProvenance(
            operation=SqlDerivation(sql=sql),
            inputs=[
                DerivationInput(role="input", value=node_reference(node.id))
                for node in inputs
            ],
        ),
    )
    workspace.add_node(node)
    return node


def _execute_sql(inputs: list[Node], sql: str) -> pl.LazyFrame:
    if _contains_external_reader(sql):
        raise InvalidInputError("External SQL reader functions are not allowed")
    try:
        with pl.SQLContext(eager=False) as context:
            for node in inputs:
                context.register(node.id, node.data)
            result = context.execute(sql)
        return result
    except pl.exceptions.PolarsError as exc:
        raise InvalidInputError(str(exc)) from exc


def _contains_external_reader(sql: str) -> bool:
    """Find external reader calls outside SQL strings, identifiers, and comments."""

    index = 0
    length = len(sql)
    while index < length:
        char = sql[index]
        next_char = sql[index + 1] if index + 1 < length else ""
        if char == "'":
            index = _skip_quoted(sql, index, "'")
            continue
        if char == '"':
            index = _skip_quoted(sql, index, '"')
            continue
        if char == "-" and next_char == "-":
            newline = sql.find("\n", index + 2)
            index = length if newline == -1 else newline + 1
            continue
        if char == "/" and next_char == "*":
            end = sql.find("*/", index + 2)
            index = length if end == -1 else end + 2
            continue
        if char.isalpha() or char == "_":
            end = index + 1
            while end < length and (sql[end].isalnum() or sql[end] == "_"):
                end += 1
            identifier = sql[index:end]
            following = _skip_sql_trivia(sql, end)
            if (
                following < length
                and sql[following] == "("
                and _EXTERNAL_READER.fullmatch(identifier)
            ):
                return True
            index = end
            continue
        index += 1
    return False


def _skip_quoted(sql: str, start: int, quote: str) -> int:
    index = start + 1
    while index < len(sql):
        if sql[index] != quote:
            index += 1
            continue
        if index + 1 < len(sql) and sql[index + 1] == quote:
            index += 2
            continue
        return index + 1
    return len(sql)


def _skip_sql_trivia(sql: str, start: int) -> int:
    index = start
    while index < len(sql):
        if sql[index].isspace():
            index += 1
            continue
        if sql.startswith("--", index):
            newline = sql.find("\n", index + 2)
            index = len(sql) if newline == -1 else newline + 1
            continue
        if sql.startswith("/*", index):
            end = sql.find("*/", index + 2)
            index = len(sql) if end == -1 else end + 2
            continue
        return index
    return index


__all__ = ["WorkspaceSqlService"]
