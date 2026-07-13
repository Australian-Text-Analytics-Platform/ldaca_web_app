# Backend API Reference

This is the canonical HTTP inventory for the current backend. The executable
contract is generated OpenAPI plus `backend/tests/unit/test_current_api_surface.py`.
All `/api` operations use the identity dependency unless marked public. Unsafe
operations also require exact Origin and CSRF proof, except provider callbacks
with their own one-use validation.

## Session And Providers

| Method and path | Operation ID | Success | Purpose |
|---|---|---:|---|
| `GET /api/session` | `get_session` | 200 | Public/optional-cookie bootstrap and CSRF token |
| `DELETE /api/session` | `delete_session` | 204 | Revoke the presented hosted Session |
| `POST /api/auth/google/callback` | `google_callback` | 303 | Public Google credential callback |
| `GET /api/auth/cilogon/login` | `cilogon_login` | 302 | Public CILogon authorization redirect |
| `GET /api/auth/cilogon/callback` | `cilogon_callback` | 303 | Public CILogon OIDC callback |
| `POST /api/annotation-providers/{provider}/models` | `list_annotation_models` | 200 | Resolve configured provider model IDs |

## User Files And External Data

| Method and path | Operation ID | Success | Purpose |
|---|---|---:|---|
| `GET /api/files` | `list_files` | 200 | Paginated user file listing |
| `GET /api/files/resource` | `get_file_resource` | 200 | Address one file or directory |
| `PATCH /api/files` | `move_file` | 200 | Move without replacement |
| `DELETE /api/files` | `delete_file` | 204 | Delete a file or directory |
| `POST /api/files/folders` | `create_folder` | 201 | Create an addressable folder |
| `POST /api/files/uploads` | `upload_file` | 201 | Stream and atomically publish a file |
| `GET /api/files/raw` | `get_raw_file` | 200 | Bounded text read |
| `GET /api/files/content` | `download_file` | 200 | Binary snapshot download |
| `POST /api/files/preview` | `preview_file` | 200 | Typed tabular preview |
| `GET /api/sample-collections` | `list_sample_collections` | 200 | Verified sample catalogue |
| `POST /api/sample-collections/{collection_id}/import-tasks` | `submit_sample_import` | 202 | Queue a sample import Task |
| `POST /api/data-portal/search` | `search_data_portal` | 200 | Search the configured Oni portal |
| `POST /api/data-portal/featured` | `list_featured_data_portal_collections` | 200 | Read configured featured collections |
| `POST /api/data-portal/import-tasks` | `submit_data_portal_import` | 202 | Queue a portal import Task |

## Tasks

| Method and path | Operation ID | Success | Purpose |
|---|---|---:|---|
| `GET /api/tasks/events` | `task_events` | 200 SSE | Snapshot plus bounded live Task events |
| `GET /api/tasks/{task_id}` | `get_task` | 200 | Read an owned Task |
| `POST /api/tasks/{task_id}/cancel` | `cancel_task` | 202/200 | Request or repeat cancellation |
| `DELETE /api/tasks/{task_id}` | `delete_task` | 204 | Delete a terminal child-free Task |
| `GET /api/tasks/{task_id}/artifacts/{artifact_name}` | `download_task_artifact` | 200 | Download a declared Artifact |

## Workspaces And Archives

| Method and path | Operation ID | Success | Purpose |
|---|---|---:|---|
| `GET /api/workspaces` | `list_workspaces` | 200 | List persisted Workspaces |
| `POST /api/workspaces` | `create_workspace` | 201 | Create a Revision-1 Workspace |
| `POST /api/workspaces/imports` | `import_workspace_archive` | 201 | Validate and install an archive |
| `GET /api/workspaces/{workspace_id}` | `get_workspace_by_id` | 200 | Read metadata and graph |
| `PATCH /api/workspaces/{workspace_id}` | `update_workspace_by_id` | 200 | Conditional metadata update |
| `DELETE /api/workspaces/{workspace_id}` | `delete_workspace_by_id` | 204 | Conditional atomic deletion |
| `GET /api/workspaces/{workspace_id}/archive` | `export_workspace_archive` | 200 ZIP | Export a committed snapshot |

## Data Blocks And Annotation

The API uses `nodes` for the backend representation of Data Blocks.

| Method and path | Operation ID | Success | Purpose |
|---|---|---:|---|
| `POST /api/workspaces/{workspace_id}/nodes` | `create_node` | 201 | Create a source or derived Data Block |
| `POST /api/workspaces/{workspace_id}/nodes/previews` | `preview_node_creation` | 200 | Preview a derived Data Block |
| `PUT /api/workspaces/{workspace_id}/nodes/order` | `reorder_workspace_nodes_by_id` | 200 | Persist complete Data Block order |
| `GET /api/workspaces/{workspace_id}/nodes/{node_id}` | `get_node` | 200 | Read complete Data Block metadata |
| `PATCH /api/workspaces/{workspace_id}/nodes/{node_id}` | `update_node` | 200 | Conditional metadata update |
| `DELETE /api/workspaces/{workspace_id}/nodes/{node_id}` | `delete_node` | 204 | Conditional graph-preserving deletion |
| `GET /api/workspaces/{workspace_id}/nodes/{node_id}/rows` | `get_node_rows` | 200 | Paginated sorted rows |
| `POST /api/workspaces/{workspace_id}/nodes/{node_id}/annotation-previews` | `preview_annotation` | 200 | Stateless bounded provider preview |
| `POST /api/workspaces/{workspace_id}/nodes/{node_id}/annotation-tasks` | `submit_annotation_task` | 202 | Queue full annotation |

## Analysis

| Method and path | Operation ID | Success | Purpose |
|---|---|---:|---|
| `POST /api/workspaces/{workspace_id}/analysis-tasks` | `submit_analysis_task` | 202 | Snapshot inputs and queue an Analysis |
| `GET /api/workspaces/{workspace_id}/analysis-tasks/{task_id}` | `get_analysis_task` | 200 | Workspace-constrained Task lookup |
| `GET /api/workspaces/{workspace_id}/analysis-tasks/{task_id}/result` | `get_analysis_result` | 200 | Typed first-page Result |
| `POST /api/workspaces/{workspace_id}/analysis-tasks/{task_id}/result/query` | `query_analysis_result` | 200 | Alternate typed Result projection |
| `PATCH /api/workspaces/{workspace_id}/analysis-tasks/{task_id}/preferences` | `update_analysis_preferences` | 200 | Update presentation preferences |
| `POST /api/workspaces/{workspace_id}/analysis-tasks/{task_id}/children` | `submit_analysis_child_task` | 202 | Queue detachment/materialization |

## Readiness And Common Semantics

`GET /health` (`health_check`) is public and returns readiness plus installed
package version.

- Addressable creation returns `201` and relative `Location`; accepted work
  returns `202`; empty deletion returns `204`.
- Workspace mutations require `If-Match`; a missing precondition is `428` and
  a stale Revision is `409 workspace_conflict`.
- A Result before Task success is `409 task_not_succeeded`; a missing successful
  Artifact is `410 artifact_gone`.
- Cross-user Workspace and Task lookup returns `404`.
- Validation uses sanitized `422 ApiError` responses with `X-Request-ID`.
- Pagination is one-based and rejects zero.
