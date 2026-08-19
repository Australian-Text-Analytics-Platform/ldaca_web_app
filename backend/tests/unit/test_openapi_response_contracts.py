"""OpenAPI response-shape and HTTP-semantics guardrails."""

from __future__ import annotations

from typing import Any

from ldaca_wordflow.asgi import app


HTTP_METHODS = {"delete", "get", "patch", "post", "put"}


def _success_responses() -> list[tuple[str, str, str, dict[str, Any]]]:
    return [
        (path, method, code, response)
        for path, path_item in app.openapi()["paths"].items()
        for method, operation in path_item.items()
        if method in HTTP_METHODS
        for code, response in operation["responses"].items()
        if code.startswith("2") or code.startswith("3")
    ]


def test_every_success_response_is_typed_or_declares_its_stream_media() -> None:
    missing = []
    for path, method, code, response in _success_responses():
        if code == "204" or code.startswith("3"):
            continue
        content = response.get("content", {})
        if not content:
            missing.append((method.upper(), path, code))
            continue
        for media_type, media in content.items():
            schema = media.get("schema", {})
            if not schema and media_type != "text/event-stream":
                missing.append((method.upper(), path, code, media_type))
    assert missing == []


def test_empty_deletions_are_real_204_responses() -> None:
    schema = app.openapi()
    endpoints = {
        ("/api/session", "delete"),
        ("/api/user-files", "delete"),
        ("/api/user-file-imports/{import_id}", "delete"),
        ("/api/workspaces/{workspace_id}", "delete"),
        ("/api/workspaces/{workspace_id}/nodes/{node_id}", "delete"),
        ("/api/workspaces/{workspace_id}/tabs/{tab_id}", "delete"),
        ("/api/workspaces/{workspace_id}/tabs/{tab_id}/analyses", "delete"),
    }
    for path, method in endpoints:
        responses = schema["paths"][path][method]["responses"]
        assert set(responses) >= {"204"}
        assert "content" not in responses["204"]


def test_creation_background_and_oauth_status_codes_are_explicit() -> None:
    schema = app.openapi()["paths"]
    expected = {
        ("/api/workspaces", "post"): "201",
        ("/api/workspaces/{workspace_id}/tabs", "post"): "201",
        ("/api/workspaces/{workspace_id}/tabs/{tab_id}/analyses", "post"): "201",
        ("/api/user-files/uploads", "post"): "201",
        ("/api/user-files/folders", "post"): "201",
        ("/api/workspaces/{workspace_id}/nodes", "post"): "201",
        ("/api/sample-collections/{collection_id}/imports", "post"): "202",
        ("/api/data-portal/imports", "post"): "202",
        ("/api/auth/google/callback", "post"): "303",
        ("/api/auth/cilogon/login", "get"): "302",
        ("/api/auth/cilogon/callback", "get"): "303",
    }
    for (path, method), status_code in expected.items():
        assert status_code in schema[path][method]["responses"]


def test_file_archive_artifact_and_sse_media_types_are_documented() -> None:
    schema = app.openapi()["paths"]
    assert (
        "application/octet-stream"
        in schema["/api/user-files/content"]["get"]["responses"]["200"]["content"]
    )
    assert (
        "application/zip"
        in schema["/api/workspaces/{workspace_id}/archive"]["get"]["responses"]["200"][
            "content"
        ]
    )
    assert (
        "application/octet-stream"
        in schema[
            "/api/workspaces/{workspace_id}/analyses/{analysis_id}/artifacts/{artifact_name}"
        ]["get"]["responses"]["200"]["content"]
    )
    assert (
        "text/event-stream"
        in schema["/api/events"]["get"]["responses"]["200"]["content"]
    )


def test_analysis_requests_results_and_queries_are_discriminated() -> None:
    paths = app.openapi()["paths"]
    analysis_create = app.openapi()["components"]["schemas"]["AnalysisCreate"]
    definitions = (
        analysis_create["properties"]["request"],
        paths[
            "/api/workspaces/{workspace_id}/analyses/{analysis_id}/result/query"
        ]["post"]["requestBody"]["content"]["application/json"]["schema"],
        paths["/api/workspaces/{workspace_id}/analyses/{analysis_id}/result"]["get"]
        ["responses"]["200"]["content"]["application/json"]["schema"],
    )
    for definition in definitions:
        assert "oneOf" in definition
        assert definition["discriminator"]["propertyName"] == "kind"
    assert (
        "/api/workspaces/{workspace_id}/analyses/{analysis_id}/preferences"
        not in paths
    )


def test_annotation_requests_share_one_annotation_class_schema() -> None:
    schemas = app.openapi()["components"]["schemas"]
    annotation_class_schemas = [
        name
        for name, definition in schemas.items()
        if definition.get("title") == "AnnotationClass"
    ]

    assert annotation_class_schemas == ["AnnotationClass"]
    expected_ref = {"$ref": "#/components/schemas/AnnotationClass"}
    for request_name in (
        "AnnotationAnalysisRequest",
        "AnnotationAnalysisSubmission",
    ):
        assert schemas[request_name]["properties"]["classes"]["items"] == expected_ref
        assert "correction_column" in schemas[request_name]["properties"]
        assert "batch_size" not in schemas[request_name]["properties"]
        assert "processing_mode" not in schemas[request_name]["properties"]

    assert set(schemas["AnnotationRunAllAnalysisRequest"]["properties"]) == {
        "batch_size",
        "kind",
        "processing_mode",
        "source",
    }
    assert set(schemas["AnnotationRunAllSubmission"]["properties"]) == {
        "api_key",
        "batch_size",
        "kind",
        "processing_mode",
        "source",
    }
    assert set(schemas["AnnotationRunAllResult"]["properties"]) == {
        "affected_node_id",
        "annotated_count",
        "annotation_column",
        "attempted_count",
        "committed_workspace_revision",
        "failed_batch_count",
        "failed_row_count",
        "kind",
        "record_count",
    }


def test_workspace_owned_analysis_representation_is_exact() -> None:
    schema = app.openapi()
    analysis = schema["components"]["schemas"]["Analysis"]
    assert set(analysis["properties"]) == {
        "id",
        "tab_id",
        "parent_analysis_id",
        "execution_scope",
        "supersedes_analysis_ids",
        "request",
        "state",
        "progress",
        "cancellation_requested_at",
        "error",
        "integrity",
        "created_at",
        "started_at",
        "finished_at",
        "revision",
        "output_node_ids",
    }
    assert set(analysis["required"]) == set(analysis["properties"])


def test_storage_policy_is_a_strict_discriminated_resource() -> None:
    schema = app.openapi()["paths"]["/api/storage"]["get"]["responses"]["200"]
    resource = schema["content"]["application/json"]["schema"]

    assert len(resource["oneOf"]) == 2
    assert resource["discriminator"]["propertyName"] == "policy"


def test_workspace_catalogue_is_a_discriminated_union() -> None:
    schema = app.openapi()
    collection = schema["paths"]["/api/workspaces"]["get"]["responses"]["200"]
    item = collection["content"]["application/json"]["schema"]["items"]

    assert item["discriminator"]["propertyName"] == "availability"
    assert item["discriminator"]["mapping"] == {
        "available": "#/components/schemas/AvailableWorkspaceListItem",
        "unavailable": "#/components/schemas/UnavailableWorkspaceListItem",
    }
    assert len(item["oneOf"]) == 2


def test_tab_resources_are_exact_and_the_collection_is_unpaginated() -> None:
    schema = app.openapi()
    tab = schema["components"]["schemas"]["Tab"]
    assert set(tab["properties"]) == {
        "id",
        "kind",
        "name",
        "analysis_ids",
        "annotation_correction_columns",
        "stop_words",
        "topic_modeling_words_per_topic",
        "topic_modeling_projection_selection",
        "created_at",
        "modified_at",
        "revision",
    }
    assert set(tab["required"]) == set(tab["properties"]) - {
        "analysis_ids",
        "annotation_correction_columns",
        "stop_words",
        "topic_modeling_words_per_topic",
        "topic_modeling_projection_selection",
    }
    collection = schema["paths"]["/api/workspaces/{workspace_id}/tabs"]["get"]
    assert [parameter["name"] for parameter in collection["parameters"]] == [
        "workspace_id"
    ]
    response = collection["responses"]["200"]["content"]["application/json"][
        "schema"
    ]
    assert response["type"] == "array"
    assert response["items"] == {"$ref": "#/components/schemas/Tab"}


def test_pagination_is_one_based_everywhere_it_is_exposed() -> None:
    schemas = app.openapi()["components"]["schemas"]
    paged = [
        definition
        for definition in schemas.values()
        if isinstance(definition, dict)
        and isinstance(definition.get("properties"), dict)
        and "page" in definition["properties"]
    ]
    assert paged
    for definition in paged:
        page = definition["properties"]["page"]
        minimum = page.get("minimum")
        if minimum is None:
            minimum = next(
                option.get("minimum")
                for option in page.get("anyOf", [])
                if option.get("type") == "integer"
            )
        assert minimum == 1


def test_topic_modeling_result_is_complete_and_not_paginated() -> None:
    schemas = app.openapi()["components"]["schemas"]

    assert "pagination" not in schemas["TopicModelingResult"]["properties"]
    query_properties = schemas["TopicModelingResultQuery"]["properties"]
    assert "page" not in query_properties
    assert "page_size" not in query_properties


def test_every_validation_response_uses_the_safe_api_error_contract() -> None:
    """FastAPI's input-bearing validation schema must never leak into OpenAPI."""

    schema = app.openapi()
    validation_refs = {
        response["content"]["application/json"]["schema"].get("$ref")
        for path_item in schema["paths"].values()
        for method, operation in path_item.items()
        if method in HTTP_METHODS
        for code, response in operation["responses"].items()
        if code == "422"
    }
    assert validation_refs == {"#/components/schemas/ApiError"}
    assert "HTTPValidationError" not in schema["components"]["schemas"]
    assert "ValidationError" not in schema["components"]["schemas"]


def test_public_json_is_recursive_and_analysis_results_are_semantic_resources() -> None:
    """Generated clients receive real JSON unions and no generic payload envelope."""

    schemas = app.openapi()["components"]["schemas"]
    for name in ("JsonData-Input", "JsonData-Output"):
        branches = schemas[name].get("anyOf", [])
        assert {branch.get("type") for branch in branches} >= {
            "array",
            "boolean",
            "integer",
            "null",
            "number",
            "object",
            "string",
        }

    for name in (
        "ConcordanceResult",
        "QuotationResult",
        "SequentialResult",
        "TokenFrequencyResult",
        "TopicModelingResult",
    ):
        properties = schemas[name]["properties"]
        assert "payload" not in properties
        assert "task_id" not in properties
        assert "result_version" not in properties


def test_read_only_collection_routes_do_not_advertise_unrelated_errors() -> None:
    """Responses remain operation-specific instead of inheriting a global catalogue."""

    paths = app.openapi()["paths"]
    assert set(paths["/api/workspaces"]["get"]["responses"]) == {"200", "401"}
    assert set(paths["/api/events"]["get"]["responses"]) == {"200", "401"}
    assert set(paths["/health"]["get"]["responses"]) == {"200", "503"}
