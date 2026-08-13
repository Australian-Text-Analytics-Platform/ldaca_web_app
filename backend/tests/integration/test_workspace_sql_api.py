"""Workspace SQL query and Derived Data Block contracts."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

import polars as pl
from fastapi.testclient import TestClient

from ldaca_wordflow.main import create_app
from ldaca_wordflow.settings import Settings


def _client(tmp_path: Path) -> TestClient:
    return TestClient(
        create_app(
            Settings(
                data_root=tmp_path,
                multi_user=False,
                session_cookie_secure=False,
                cors_allowed_origins=("http://testserver",),
                trusted_hosts=("testserver",),
            ),
            serve_frontend=False,
        ),
        base_url="http://testserver",
    )


def _workspace_with_sources(
    client: TestClient,
    *sources: tuple[str, bytes],
) -> tuple[str, dict[str, str], list[str]]:
    csrf = client.get("/api/session").json()["csrf_token"]
    unsafe = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
    for path, content in sources:
        response = client.post(
            "/api/user-files/uploads",
            params={"path": path},
            content=content,
            headers={**unsafe, "Content-Type": "application/octet-stream"},
        )
        assert response.status_code == 201
    workspace = client.post(
        "/api/workspaces",
        json={"name": "SQL contract"},
        headers=unsafe,
    )
    assert workspace.status_code == 201
    workspace_id = workspace.json()["id"]
    assert (
        client.put(f"/api/workspaces/{workspace_id}/open", headers=unsafe).status_code
        == 200
    )
    node_ids = [
        client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={"kind": "file", "file_path": path},
            headers=unsafe,
        ).json()["id"]
        for path, _content in sources
    ]
    return workspace_id, unsafe, node_ids


def test_workspace_sql_query_uses_declared_uuid_tables_and_outer_pagination(
    tmp_path: Path,
) -> None:
    with _client(tmp_path) as client:
        workspace_id, unsafe, [node_id] = _workspace_with_sources(
            client,
            ("source.csv", b"value,label\n3,c\n1,a\n2,b\n"),
        )
        response = client.post(
            f"/api/workspaces/{workspace_id}/sql",
            json={
                "mode": "query",
                "node_ids": [node_id],
                "sql": f'SELECT value, label FROM "{node_id}" ORDER BY value',
                "page": 1,
                "page_size": 2,
            },
            headers=unsafe,
        )

        assert response.status_code == 200
        assert response.headers["content-type"].startswith(
            "application/vnd.apache.arrow.stream"
        )
        assert "no-store" in response.headers["cache-control"]
        assert response.headers["x-wordflow-has-next"] == "true"
        assert response.headers["etag"]
        assert pl.read_ipc_stream(BytesIO(response.content)).to_dicts() == [
            {"value": 1, "label": "a"},
            {"value": 2, "label": "b"},
        ]


def test_workspace_sql_filters_annotation_differences_before_pagination(
    tmp_path: Path,
) -> None:
    parquet = BytesIO()
    pl.DataFrame(
        {
            "annotation": ["same", "a", "a", "a", None, "a"],
            "first": ["same", "b", "a", "b", "b", None],
            "second": ["same", "a", "b", "b", "b", "a"],
        }
    ).write_parquet(parquet)

    with _client(tmp_path) as client:
        workspace_id, unsafe, [node_id] = _workspace_with_sources(
            client,
            ("source.parquet", parquet.getvalue()),
        )
        indexed = (
            'WITH "indexed" AS ('
            'SELECT ROW_NUMBER() OVER () - 1 AS "source_row_index", * '
            f'FROM "{node_id}"), '
            '"filtered" AS (SELECT * FROM "indexed" '
            'WHERE "annotation" != "first" OR "annotation" != "second") '
        )
        first_page = client.post(
            f"/api/workspaces/{workspace_id}/sql",
            json={
                "mode": "query",
                "node_ids": [node_id],
                "sql": f'{indexed}SELECT * FROM "filtered" ORDER BY "source_row_index"',
                "page": 1,
                "page_size": 2,
            },
            headers=unsafe,
        )
        second_page = client.post(
            f"/api/workspaces/{workspace_id}/sql",
            json={
                "mode": "query",
                "node_ids": [node_id],
                "sql": f'{indexed}SELECT * FROM "filtered" ORDER BY "source_row_index"',
                "page": 2,
                "page_size": 2,
            },
            headers=unsafe,
        )
        count = client.post(
            f"/api/workspaces/{workspace_id}/sql",
            json={
                "mode": "query",
                "node_ids": [node_id],
                "sql": f'{indexed}SELECT COUNT(*) AS "total_rows" FROM "filtered"',
                "page": 1,
                "page_size": 1,
            },
            headers=unsafe,
        )

        assert first_page.status_code == 200, first_page.text
        assert first_page.headers["x-wordflow-has-next"] == "true"
        assert [
            row["source_row_index"]
            for row in pl.read_ipc_stream(BytesIO(first_page.content)).to_dicts()
        ] == [1, 2]
        assert second_page.status_code == 200, second_page.text
        assert [
            row["source_row_index"]
            for row in pl.read_ipc_stream(BytesIO(second_page.content)).to_dicts()
        ] == [3]
        assert count.status_code == 200, count.text
        assert pl.read_ipc_stream(BytesIO(count.content)).to_dicts() == [
            {"total_rows": 3}
        ]


def test_workspace_sql_create_records_ordered_lineage_and_survives_context_close(
    tmp_path: Path,
) -> None:
    with _client(tmp_path) as client:
        workspace_id, unsafe, node_ids = _workspace_with_sources(
            client,
            ("left.csv", b"id,left_value\n1,a\n2,b\n"),
            ("right.csv", b"id,right_value\n2,c\n1,d\n"),
        )
        left_id, right_id = node_ids
        response = client.post(
            f"/api/workspaces/{workspace_id}/sql",
            json={
                "mode": "create",
                "node_ids": [left_id, right_id],
                "sql": (
                    f'SELECT l.id, l.left_value, r.right_value FROM "{left_id}" AS l '
                    f'JOIN "{right_id}" AS r ON l.id = r.id ORDER BY l.id'
                ),
                "name": "SQL join",
            },
            headers=unsafe,
        )

        assert response.status_code == 201
        created = response.json()
        assert created["name"] == "SQL join"
        assert created["parent_ids"] == [left_id, right_id]
        assert created["provenance"]["operation"]["kind"] == "sql"
        assert created["provenance"]["operation"]["sql"] == (
            f'SELECT l.id, l.left_value, r.right_value FROM "{left_id}" AS l '
            f'JOIN "{right_id}" AS r ON l.id = r.id ORDER BY l.id'
        )
        assert created["can_undo"] is False
        assert created["can_redo"] is False
        assert response.headers["location"].endswith(f"/nodes/{created['id']}")

        assert (
            client.delete(
                f"/api/workspaces/{workspace_id}/open", headers=unsafe
            ).status_code
            == 204
        )
        assert (
            client.put(
                f"/api/workspaces/{workspace_id}/open", headers=unsafe
            ).status_code
            == 200
        )
        queried = client.post(
            f"/api/workspaces/{workspace_id}/sql",
            json={
                "mode": "query",
                "node_ids": [created["id"]],
                "sql": f'SELECT * FROM "{created["id"]}"',
            },
            headers=unsafe,
        )
        assert queried.status_code == 200
        assert pl.read_ipc_stream(BytesIO(queried.content)).to_dicts() == [
            {"id": 1, "left_value": "a", "right_value": "d"},
            {"id": 2, "left_value": "b", "right_value": "c"},
        ]


def test_workspace_sql_rejects_external_readers_but_not_literals_or_comments(
    tmp_path: Path,
) -> None:
    with _client(tmp_path) as client:
        workspace_id, unsafe, [node_id] = _workspace_with_sources(
            client,
            ("source.csv", b"value\n1\n"),
        )
        for sql in (
            "SELECT * FROM READ_CSV('file:///tmp/private.csv')",
            "SELECT * FROM scan_parquet /* no bypass */ ('private.parquet')",
            "SELECT * FROM read_ndjson -- no bypass\n ('private.ndjson')",
        ):
            rejected = client.post(
                f"/api/workspaces/{workspace_id}/sql",
                json={
                    "mode": "query",
                    "node_ids": [node_id],
                    "sql": sql,
                },
                headers=unsafe,
            )
            assert rejected.status_code == 400
            assert rejected.json()["message"] == (
                "External SQL reader functions are not allowed"
            )

        allowed = client.post(
            f"/api/workspaces/{workspace_id}/sql",
            json={
                "mode": "query",
                "node_ids": [node_id],
                "sql": (
                    f'SELECT \'scan_csv(\"secret\")\' AS note, value '
                    f'FROM "{node_id}" -- read_parquet("secret")'
                ),
            },
            headers=unsafe,
        )
        assert allowed.status_code == 200


def test_workspace_sql_validates_inputs_and_surfaces_polars_errors(
    tmp_path: Path,
) -> None:
    with _client(tmp_path) as client:
        workspace_id, unsafe, [node_id] = _workspace_with_sources(
            client,
            ("source.csv", b"value\n1\n"),
        )
        duplicate = client.post(
            f"/api/workspaces/{workspace_id}/sql",
            json={
                "mode": "query",
                "node_ids": [node_id, node_id],
                "sql": f'SELECT * FROM "{node_id}"',
            },
            headers=unsafe,
        )
        assert duplicate.status_code == 422

        invalid = client.post(
            f"/api/workspaces/{workspace_id}/sql",
            json={
                "mode": "query",
                "node_ids": [node_id],
                "sql": f'SELECT missing FROM "{node_id}"',
            },
            headers=unsafe,
        )
        assert invalid.status_code == 400
        assert invalid.json()["code"] == "invalid_input"
        assert "missing" in invalid.json()["message"]


def test_workspace_sql_supports_distinct_search_and_list_unnesting(
    tmp_path: Path,
) -> None:
    parquet = BytesIO()
    pl.DataFrame(
        {
            "speaker": ["Alice", "Bob", "Alice", None],
            "tags": [["news", "local"], ["sport"], ["news"], None],
        }
    ).write_parquet(parquet)

    with _client(tmp_path) as client:
        workspace_id, unsafe, [node_id] = _workspace_with_sources(
            client,
            ("source.parquet", parquet.getvalue()),
        )
        searched = client.post(
            f"/api/workspaces/{workspace_id}/sql",
            json={
                "mode": "query",
                "node_ids": [node_id],
                "sql": (
                    'SELECT DISTINCT "value" FROM '
                    f'(SELECT "speaker" AS "value" FROM "{node_id}") AS "values" '
                    "WHERE CAST(\"value\" AS VARCHAR) ~* '^a.*$' "
                    'ORDER BY "value" ASC NULLS FIRST'
                ),
                "page": 1,
                "page_size": 500,
            },
            headers=unsafe,
        )
        assert searched.status_code == 200
        assert pl.read_ipc_stream(BytesIO(searched.content)).to_dicts() == [
            {"value": "Alice"}
        ]

        unnested = client.post(
            f"/api/workspaces/{workspace_id}/sql",
            json={
                "mode": "query",
                "node_ids": [node_id],
                "sql": (
                    'SELECT DISTINCT "value" FROM '
                    f'(SELECT UNNEST("tags") AS "value" FROM "{node_id}") AS "values" '
                    'ORDER BY "value" ASC NULLS FIRST'
                ),
                "page": 1,
                "page_size": 500,
            },
            headers=unsafe,
        )
        assert unnested.status_code == 200
        assert pl.read_ipc_stream(BytesIO(unnested.content)).to_dicts() == [
            {"value": None},
            {"value": "local"},
            {"value": "news"},
            {"value": "sport"},
        ]
