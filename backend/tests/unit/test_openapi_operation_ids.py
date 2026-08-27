"""OpenAPI naming and layering invariants for generated clients."""

from __future__ import annotations

from ldaca_wordflow.asgi import app


HTTP_METHODS = {"delete", "get", "patch", "post", "put"}


def _operations():
    schema = app.openapi()
    return [
        (path, method, operation)
        for path, path_item in schema["paths"].items()
        for method, operation in path_item.items()
        if method in HTTP_METHODS
    ]


def test_operation_ids_are_unique_stable_route_names() -> None:
    operation_ids = [operation["operationId"] for _, _, operation in _operations()]
    assert len(operation_ids) == len(set(operation_ids))
    assert all("_api_" not in operation_id for operation_id in operation_ids)


def test_each_operation_has_one_nonduplicated_domain_tag() -> None:
    offenders = []
    for path, method, operation in _operations():
        tags = operation.get("tags", [])
        if len(tags) != 1 or len(tags) != len(set(tags)):
            offenders.append((method.upper(), path, tags))
    assert offenders == []


def test_resource_routes_have_no_action_aliases_or_hidden_workspace_selection() -> None:
    paths = set(app.openapi()["paths"])
    forbidden_fragments = {
        "/current-workspace",
        "/unload",
        "/save",
        "/clear",
        "/status",
        "/config",
        "/annotation-ai-preview-sessions",
    }
    assert not {
        path
        for path in paths
        if any(fragment in path for fragment in forbidden_fragments)
    }
    assert "/api" not in paths
    assert "/status" not in paths


def test_public_health_contracts_are_minimal() -> None:
    paths = app.openapi()["paths"]
    assert set(paths["/health/live"]["get"]["responses"]) == {"200"}
    assert set(paths["/health/ready"]["get"]["responses"]) == {"200", "503"}
