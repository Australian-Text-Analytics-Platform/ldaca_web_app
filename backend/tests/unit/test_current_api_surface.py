"""Exact guardrail for the canonical backend API surface.

This suite is the complete current contract. A route exists only when
it belongs to the current resource model; adding or removing one requires an
explicit contract decision here and in the generated OpenAPI document.
"""

from __future__ import annotations

import json

from ldaca_wordflow.asgi import app
from ldaca_wordflow.spa import _runtime_config_js


HTTP_METHODS = {"delete", "get", "patch", "post", "put"}
EXPECTED_OPERATIONS = {
    ("GET", "/api/data-root", "get_data_root"),
    ("PUT", "/api/data-root", "update_data_root"),
    ("POST", "/api/annotation-providers/models", "list_annotation_models"),
    ("GET", "/api/auth/cilogon/callback", "cilogon_callback"),
    ("GET", "/api/auth/cilogon/login", "cilogon_login"),
    ("POST", "/api/auth/google/callback", "google_callback"),
    ("POST", "/api/data-portal/featured", "list_featured_data_portal_collections"),
    ("POST", "/api/data-portal/imports", "submit_data_portal_import"),
    ("POST", "/api/data-portal/search", "search_data_portal"),
    ("GET", "/api/events", "backend_events"),
    ("GET", "/api/preferences", "get_preferences"),
    ("PATCH", "/api/preferences", "update_preferences"),
    ("GET", "/api/provider-credentials", "get_provider_credentials"),
    ("PATCH", "/api/provider-credentials", "update_data_portal_credential"),
    ("DELETE", "/api/provider-credentials", "clear_provider_credentials"),
    (
        "POST",
        "/api/provider-credentials/annotation-providers",
        "create_annotation_provider_configuration",
    ),
    (
        "DELETE",
        "/api/provider-credentials/annotation-providers",
        "clear_annotation_provider_configurations",
    ),
    (
        "PATCH",
        "/api/provider-credentials/annotation-providers/{configuration_id}",
        "update_annotation_provider_configuration",
    ),
    (
        "DELETE",
        "/api/provider-credentials/annotation-providers/{configuration_id}",
        "delete_annotation_provider_configuration",
    ),
    ("GET", "/api/user-files", "list_user_files"),
    ("GET", "/api/user-files/resource", "get_user_file_resource"),
    ("PATCH", "/api/user-files", "move_file"),
    ("DELETE", "/api/user-files", "delete_file"),
    ("GET", "/api/user-files/content", "download_file"),
    ("POST", "/api/user-files/folders", "create_folder"),
    ("GET", "/api/user-files/preview", "preview_file"),
    ("GET", "/api/user-files/preview/schema", "preview_file_schema"),
    ("GET", "/api/user-files/worksheets", "list_file_worksheets"),
    ("GET", "/api/user-files/raw", "get_raw_file"),
    ("POST", "/api/user-files/uploads", "upload_file"),
    ("GET", "/api/sample-collections", "list_sample_collections"),
    (
        "POST",
        "/api/sample-collections/{collection_id}/imports",
        "submit_sample_import",
    ),
    ("GET", "/api/session", "get_session"),
    ("DELETE", "/api/session", "delete_session"),
    ("GET", "/api/storage", "get_storage"),
    ("GET", "/api/tokenizer-models", "list_tokenizer_models"),
    ("GET", "/api/user-file-imports", "list_user_file_imports"),
    ("GET", "/api/user-file-imports/{import_id}", "get_user_file_import"),
    (
        "POST",
        "/api/user-file-imports/{import_id}/cancel",
        "cancel_user_file_import",
    ),
    (
        "DELETE",
        "/api/user-file-imports/{import_id}",
        "delete_user_file_import",
    ),
    ("GET", "/api/workspaces", "list_workspaces"),
    ("POST", "/api/workspaces", "create_workspace"),
    ("POST", "/api/workspaces/imports", "import_workspace_archive"),
    ("GET", "/api/workspaces/{workspace_id}", "get_workspace_by_id"),
    ("PATCH", "/api/workspaces/{workspace_id}", "update_workspace_by_id"),
    ("DELETE", "/api/workspaces/{workspace_id}", "delete_workspace_by_id"),
    ("GET", "/api/workspaces/{workspace_id}/analyses", "list_analyses"),
    (
        "GET",
        "/api/workspaces/{workspace_id}/analyses/{analysis_id}",
        "get_analysis",
    ),
    (
        "POST",
        "/api/workspaces/{workspace_id}/analyses/{analysis_id}/cancel",
        "cancel_analysis",
    ),
    (
        "GET",
        "/api/workspaces/{workspace_id}/analyses/{analysis_id}/result",
        "get_analysis_result",
    ),
    (
        "POST",
        "/api/workspaces/{workspace_id}/analyses/{analysis_id}/result/query",
        "query_analysis_result",
    ),
    (
        "POST",
        "/api/workspaces/{workspace_id}/analyses/{analysis_id}/result/tables/quotation-preview/query",
        "query_quotation_preview_table",
    ),
    (
        "GET",
        "/api/workspaces/{workspace_id}/analyses/{analysis_id}/result/tables/{table_id}",
        "download_analysis_table",
    ),
    (
        "GET",
        "/api/workspaces/{workspace_id}/analyses/{analysis_id}/result/tables/{table_id}/projections/{row_unit}/rows",
        "get_analysis_table_projection_rows",
    ),
    (
        "POST",
        "/api/workspaces/{workspace_id}/analyses/{analysis_id}/result/tables/{table_id}/projections/documents/query",
        "query_concordance_document_projection",
    ),
    (
        "GET",
        "/api/workspaces/{workspace_id}/analyses/{analysis_id}/result/tables/{table_id}/projections/{row_unit}/schema",
        "get_analysis_table_projection_schema",
    ),
    (
        "GET",
        "/api/workspaces/{workspace_id}/analyses/{analysis_id}/result/tables/{table_id}/density",
        "get_concordance_table_density",
    ),
    (
        "GET",
        "/api/workspaces/{workspace_id}/analyses/{analysis_id}/artifacts/{artifact_name}",
        "download_analysis_artifact",
    ),
    ("PUT", "/api/workspaces/{workspace_id}/open", "open_workspace_by_id"),
    ("DELETE", "/api/workspaces/{workspace_id}/open", "close_workspace_by_id"),
    ("GET", "/api/workspaces/{workspace_id}/archive", "export_workspace_archive"),
    ("POST", "/api/workspaces/{workspace_id}/sql", "execute_workspace_sql"),
    ("POST", "/api/workspaces/{workspace_id}/nodes", "create_node"),
    ("GET", "/api/workspaces/{workspace_id}/nodes", "list_nodes"),
    (
        "POST",
        "/api/workspaces/{workspace_id}/nodes/exports",
        "export_data_blocks",
    ),
    (
        "PUT",
        "/api/workspaces/{workspace_id}/nodes/order",
        "reorder_workspace_nodes_by_id",
    ),
    ("POST", "/api/workspaces/{workspace_id}/nodes/previews", "preview_node_creation"),
    ("GET", "/api/workspaces/{workspace_id}/nodes/{node_id}", "get_node"),
    ("PATCH", "/api/workspaces/{workspace_id}/nodes/{node_id}", "update_node"),
    ("DELETE", "/api/workspaces/{workspace_id}/nodes/{node_id}", "delete_node"),
    (
        "POST",
        "/api/workspaces/{workspace_id}/nodes/{node_id}/edits",
        "edit_node",
    ),
    (
        "POST",
        "/api/workspaces/{workspace_id}/nodes/{node_id}/undo",
        "undo_node",
    ),
    (
        "POST",
        "/api/workspaces/{workspace_id}/nodes/{node_id}/redo",
        "redo_node",
    ),
    ("GET", "/api/workspaces/{workspace_id}/nodes/{node_id}/schema", "get_node_schema"),
    ("GET", "/api/workspaces/{workspace_id}/tabs", "list_tabs"),
    ("POST", "/api/workspaces/{workspace_id}/tabs", "create_tab"),
    ("GET", "/api/workspaces/{workspace_id}/tabs/{tab_id}", "get_tab"),
    ("PATCH", "/api/workspaces/{workspace_id}/tabs/{tab_id}", "update_tab"),
    ("DELETE", "/api/workspaces/{workspace_id}/tabs/{tab_id}", "delete_tab"),
    (
        "GET",
        "/api/workspaces/{workspace_id}/tabs/{tab_id}/analyses",
        "list_tab_analyses",
    ),
    (
        "POST",
        "/api/workspaces/{workspace_id}/tabs/{tab_id}/analyses",
        "submit_tab_analysis",
    ),
    (
        "DELETE",
        "/api/workspaces/{workspace_id}/tabs/{tab_id}/analyses",
        "clear_tab_analysis",
    ),
    ("GET", "/health/live", "liveness_check"),
    ("GET", "/health/ready", "readiness_check"),
}


def _operations() -> set[tuple[str, str, str]]:
    return {
        (method.upper(), path, operation["operationId"])
        for path, path_item in app.openapi()["paths"].items()
        for method, operation in path_item.items()
        if method in HTTP_METHODS
    }


def test_openapi_surface_is_exactly_the_canonical_resource_api() -> None:
    assert _operations() == EXPECTED_OPERATIONS


def test_cookie_security_is_explicit_and_no_bearer_or_query_token_is_advertised() -> (
    None
):
    schema = app.openapi()
    assert schema["components"]["securitySchemes"] == {
        "WordflowSession": {
            "type": "apiKey",
            "description": "HttpOnly hosted-browser session cookie",
            "in": "cookie",
            "name": "wordflow_session",
        }
    }

    public = {
        ("GET", "/health/live"),
        ("GET", "/health/ready"),
        ("GET", "/api/data-root"),
        ("PUT", "/api/data-root"),
        ("GET", "/api/auth/cilogon/login"),
        ("GET", "/api/auth/cilogon/callback"),
        ("POST", "/api/auth/google/callback"),
    }
    optional_cookie = {("GET", "/api/session")}
    for method, path, _operation_id in EXPECTED_OPERATIONS:
        operation = schema["paths"][path][method.lower()]
        if (method, path) in public:
            assert "security" not in operation
        elif (method, path) in optional_cookie:
            assert operation["security"] == [{}, {"WordflowSession": []}]
        else:
            assert operation["security"] == [{"WordflowSession": []}]
        parameter_names = {
            str(parameter.get("name", "")).lower()
            for parameter in operation.get("parameters", [])
        }
        assert "authorization" not in parameter_names
        assert "token" not in parameter_names


def test_transient_provider_secrets_are_write_only_and_absent_from_resources() -> None:
    schemas = app.openapi()["components"]["schemas"]
    assert "ProviderCredentialPatch" not in schemas
    data_portal_patch = schemas["DataPortalCredentialPatch"]["properties"]
    assert set(data_portal_patch) == {"data_portal_api_token"}
    assert data_portal_patch["data_portal_api_token"]["anyOf"][0]["writeOnly"] is True

    for schema_name in (
        "AnnotationProviderConfigurationCreate",
        "AnnotationProviderConfigurationUpdate",
    ):
        field = schemas[schema_name]["properties"]["api_key"]
        assert field["anyOf"][0]["format"] == "password"
        assert field["anyOf"][0]["writeOnly"] is True

    for schema_name, field_name in (
        ("AnnotationModelsRequest", "api_key"),
        ("AnnotationAnalysisSubmission", "api_key"),
        ("AnnotationRunAllSubmission", "api_key"),
        ("DataPortalFeaturedRequest", "api_token"),
        ("DataPortalSearchRequest", "api_token"),
        ("DataPortalImportSubmitRequest", "api_token"),
    ):
        field = schemas[schema_name]["properties"][field_name]
        assert field["writeOnly"] is True
        assert field["anyOf"][0]["format"] == "password"
        assert field["anyOf"][0]["writeOnly"] is True

    assert "api_key" not in schemas["AnnotationAnalysisRequest"]["properties"]
    assert "api_token" not in schemas["DataPortalUserFileImportRequest"]["properties"]


def test_spa_runtime_config_contains_only_the_reverse_proxy_base_path() -> None:
    script = _runtime_config_js("/user/example/proxy/3000/")
    prefix = "window.__WORDFLOW_CONFIG__ = "
    assert script.startswith(prefix)
    assert script.endswith(";")
    assert json.loads(script.removeprefix(prefix).removesuffix(";")) == {
        "basePath": "/user/example/proxy/3000",
    }
