"""Workspace route identity invariants.

These tests guard the endpoint-design rule that workspace-scoped API handlers
take their target workspace from a typed URL path parameter.
"""

from __future__ import annotations

import ast
from pathlib import Path


WORKSPACES_API_DIR = (
    Path(__file__).parents[2] / "src" / "ldaca_wordflow" / "api" / "workspaces"
)
ROUTER_METHODS = {"get", "post", "put", "patch", "delete"}


def _is_router_method_decorator(decorator: ast.expr) -> bool:
    if isinstance(decorator, ast.Call):
        decorator = decorator.func
    return (
        isinstance(decorator, ast.Attribute)
        and decorator.attr in ROUTER_METHODS
        and isinstance(decorator.value, ast.Name)
    )


def _router_prefixes(tree: ast.Module) -> dict[str, str]:
    """Return APIRouter variable prefixes declared in one workspace route module.

    Used by:
    - ``test_workspace_scoped_route_handlers_use_path_workspace_identity`` so
      the invariant can detect handlers mounted on routers whose prefix, rather
      than decorator path, contains ``workspace_id``.
    """

    prefixes: dict[str, str] = {}
    for statement in tree.body:
        if not isinstance(statement, ast.Assign):
            continue
        if not isinstance(statement.value, ast.Call):
            continue
        func = statement.value.func
        if not isinstance(func, ast.Name) or func.id != "APIRouter":
            continue
        prefix = ""
        for keyword in statement.value.keywords:
            if (
                keyword.arg == "prefix"
                and isinstance(keyword.value, ast.Constant)
                and isinstance(keyword.value.value, str)
            ):
                prefix = keyword.value.value
                break
        for target in statement.targets:
            if isinstance(target, ast.Name):
                prefixes[target.id] = prefix
    return prefixes


def _workspace_scoped_route(
    node: ast.AsyncFunctionDef, prefixes: dict[str, str]
) -> str | None:
    """Return the full route path when a handler is scoped by workspace id."""

    for decorator in node.decorator_list:
        call = decorator if isinstance(decorator, ast.Call) else None
        func = call.func if call is not None else decorator
        if not _is_router_method_decorator(func):
            continue
        if not isinstance(func, ast.Attribute) or not isinstance(func.value, ast.Name):
            continue
        decorator_path = ""
        if (
            call is not None
            and call.args
            and isinstance(call.args[0], ast.Constant)
            and isinstance(call.args[0].value, str)
        ):
            decorator_path = call.args[0].value
        full_path = f"{prefixes.get(func.value.id, '')}{decorator_path}"
        if "{workspace_id" in full_path:
            return full_path
    return None


def _workspace_router_depends_on_path_loader(
    statement: ast.stmt,
) -> tuple[str, str] | None:
    """Return a router name/prefix when it still preloads a workspace path."""

    if not isinstance(statement, ast.Assign):
        return None
    if not isinstance(statement.value, ast.Call):
        return None
    func = statement.value.func
    if not isinstance(func, ast.Name) or func.id != "APIRouter":
        return None

    prefix = ""
    preloads_workspace_path = False
    for keyword in statement.value.keywords:
        if (
            keyword.arg == "prefix"
            and isinstance(keyword.value, ast.Constant)
            and isinstance(keyword.value.value, str)
        ):
            prefix = keyword.value.value
        if keyword.arg != "dependencies":
            continue
        for dependency_node in ast.walk(keyword.value):
            if isinstance(dependency_node, ast.Name) and (
                dependency_node.id == "require_workspace_path"
            ):
                preloads_workspace_path = True

    if not preloads_workspace_path or "{workspace_id" not in prefix:
        return None
    router_names = [
        target.id for target in statement.targets if isinstance(target, ast.Name)
    ]
    return ", ".join(router_names), prefix


def test_workspace_scoped_route_handlers_use_path_workspace_identity() -> None:
    """Route handlers should not recover their target id from hidden state."""

    offenders: list[str] = []
    for path in sorted(WORKSPACES_API_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        prefixes = _router_prefixes(tree)
        for statement in tree.body:
            preload = _workspace_router_depends_on_path_loader(statement)
            if preload is None:
                continue
            router_name, prefix = preload
            offenders.append(
                f"{path.relative_to(WORKSPACES_API_DIR)}:{router_name} "
                f"preloads workspace state for {prefix}"
            )
        for node in ast.walk(tree):
            if not isinstance(node, ast.AsyncFunctionDef):
                continue
            route_path = _workspace_scoped_route(node, prefixes)
            if route_path is None:
                continue
            if "{workspace_id}" not in route_path:
                offenders.append(
                    f"{path.relative_to(WORKSPACES_API_DIR)}:{node.name} "
                    f"does not carry workspace_id in {route_path}"
                )
            arg_names = {arg.arg for arg in node.args.args}
            if "workspace_id" in arg_names:
                workspace_arg = next(
                    arg for arg in node.args.args if arg.arg == "workspace_id"
                )
                annotation = (
                    ast.unparse(workspace_arg.annotation)
                    if workspace_arg.annotation is not None
                    else ""
                )
                if annotation not in {"UUID", "uuid.UUID"}:
                    offenders.append(
                        f"{path.relative_to(WORKSPACES_API_DIR)}:{node.name} "
                        f"does not type workspace_id as UUID for {route_path}"
                    )

    assert offenders == []
