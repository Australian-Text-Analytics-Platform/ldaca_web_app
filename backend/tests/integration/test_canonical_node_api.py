"""End-to-end contract for server-ordered source-node resources."""

from io import BytesIO
from pathlib import Path

import polars as pl
from fastapi.testclient import TestClient

from ldaca_wordflow.main import create_app
from ldaca_wordflow.settings import Settings


def test_source_node_resource_schema_and_removed_rows_route(tmp_path: Path) -> None:
    settings = Settings(
        data_root=tmp_path,
        multi_user=False,
        session_cookie_secure=False,
        cors_allowed_origins=("http://testserver",),
        trusted_hosts=("testserver",),
    )
    app = create_app(settings, serve_frontend=False)
    with TestClient(app, base_url="http://testserver") as client:
        csrf = client.get("/api/session").json()["csrf_token"]
        unsafe = {
            "Origin": "http://testserver",
            "X-CSRF-Token": csrf,
        }
        uploaded = client.post(
            "/api/user-files/uploads",
            params={"path": "source.csv"},
            content=b"text,count\nhello,1\nworld,2\n",
            headers={**unsafe, "Content-Type": "application/octet-stream"},
        )
        assert uploaded.status_code == 201

        workspace = client.post(
            "/api/workspaces",
            json={"name": "Node test"},
            headers=unsafe,
        )
        assert workspace.status_code == 201
        workspace_id = workspace.json()["id"]
        assert (
            client.put(f"/api/workspaces/{workspace_id}/open", headers=unsafe).status_code
            == 200
        )

        created = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={"kind": "file", "file_path": "source.csv"},
            headers=unsafe,
        )
        assert created.status_code == 201
        assert "columns" not in created.json()
        assert "dtypes" not in created.json()
        node_id = created.json()["id"]
        assert created.headers["location"].endswith(f"/nodes/{node_id}")
        node_revision = created.headers["etag"]

        no_op = client.patch(
            f"/api/workspaces/{workspace_id}/nodes/{node_id}",
            json={"name": created.json()["name"]},
            headers=unsafe,
        )
        assert no_op.status_code == 200
        assert no_op.headers["etag"] == node_revision

        selected_document = client.patch(
            f"/api/workspaces/{workspace_id}/nodes/{node_id}",
            json={"document": "text"},
            headers=unsafe,
        )
        assert selected_document.status_code == 200
        selected_revision = selected_document.headers["etag"]
        assert selected_revision != node_revision

        cleared_document = client.patch(
            f"/api/workspaces/{workspace_id}/nodes/{node_id}",
            json={"document": None},
            headers=unsafe,
        )
        assert cleared_document.status_code == 200
        node_revision = cleared_document.headers["etag"]
        assert cleared_document.json()["document"] is None

        empty_patch = client.patch(
            f"/api/workspaces/{workspace_id}/nodes/{node_id}",
            json={},
            headers=unsafe,
        )
        assert empty_patch.status_code == 422

        rows = client.post(
            f"/api/workspaces/{workspace_id}/sql",
            json={
                "mode": "query",
                "node_ids": [node_id],
                "sql": f'SELECT * FROM "{node_id}"',
                "page": 1,
                "page_size": 1,
            },
            headers=unsafe,
        )
        assert rows.status_code == 200
        assert rows.headers["x-wordflow-has-next"] == "true"
        assert pl.read_ipc_stream(BytesIO(rows.content)).to_dicts() == [
            {"text": "hello", "count": 1}
        ]

        schema = client.get(
            f"/api/workspaces/{workspace_id}/nodes/{node_id}/schema"
        )
        assert schema.status_code == 200
        schema_frame = pl.read_ipc_stream(BytesIO(schema.content))
        assert schema_frame.height == 0
        assert schema_frame.schema == pl.Schema(
            {"text": pl.String, "count": pl.Int64}
        )

        removed_rows = client.get(
            f"/api/workspaces/{workspace_id}/nodes/{node_id}/rows",
        )
        assert removed_rows.status_code == 404

        deleted = client.delete(
            f"/api/workspaces/{workspace_id}/nodes/{node_id}",
            headers=unsafe,
        )
        assert deleted.status_code == 204
        assert deleted.content == b""


def test_source_creation_persists_full_file_inference_without_normalization_notice(
    files_test_client: TestClient,
    tmp_path: Path,
) -> None:
    """Source creation fully infers, stages, and reopens the authoritative frame."""
    rows = [f"{value},{value:03d}" for value in range(101)]
    content = ("value,identifier\n" + "\n".join([*rows, "late text,101"]) + "\n").encode()
    uploaded = files_test_client.post(
        "/api/user-files/uploads",
        params={"path": "late-mixed.csv"},
        content=content,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert uploaded.status_code == 201
    workspace = files_test_client.post(
        "/api/workspaces",
        json={"name": "Full inference"},
    )
    workspace_id = workspace.json()["id"]
    assert (
        files_test_client.put(f"/api/workspaces/{workspace_id}/open").status_code
        == 200
    )

    created = files_test_client.post(
        f"/api/workspaces/{workspace_id}/nodes",
        json={"kind": "file", "file_path": "late-mixed.csv"},
    )

    assert created.status_code == 201, created.text
    resource = created.json()
    assert resource["dtype_normalization"] is None
    node_id = resource["id"]
    staged = tmp_path / "workspaces" / workspace_id / "data" / f"{node_id}.parquet"
    persisted = pl.read_parquet(staged)
    assert persisted.schema == {"value": pl.String, "identifier": pl.Int64}
    assert persisted.height == 102
    assert persisted.row(0, named=True) == {"value": "0", "identifier": 0}
    assert persisted.row(-1, named=True) == {
        "value": "late text",
        "identifier": 101,
    }

    assert files_test_client.delete(
        f"/api/workspaces/{workspace_id}/open"
    ).status_code == 204
    assert files_test_client.put(
        f"/api/workspaces/{workspace_id}/open"
    ).status_code == 200
    reopened_schema = files_test_client.get(
        f"/api/workspaces/{workspace_id}/nodes/{node_id}/schema"
    )
    assert reopened_schema.status_code == 200
    assert pl.read_ipc_stream(BytesIO(reopened_schema.content)).schema == persisted.schema


def test_source_creation_returns_invalid_input_for_parser_failures(
    files_test_client: TestClient,
) -> None:
    """Eager and deferred row-parser defects share the safe API contract."""
    workspace = files_test_client.post(
        "/api/workspaces",
        json={"name": "Invalid sources"},
    )
    workspace_id = workspace.json()["id"]
    assert (
        files_test_client.put(f"/api/workspaces/{workspace_id}/open").status_code
        == 200
    )
    malformed = {
        "invalid-utf8.csv": b"value\nvalid\n\xff\n",
        "malformed.csv": b"first,second\n1,2,3\n",
        "malformed.json": b'[{"value": 1},',
        "malformed.jsonl": b'{"value": 1}\n{"value":\n',
        "malformed.ndjson": b'{"value": 1}\n{"value":\n',
    }

    for filename, content in malformed.items():
        uploaded = files_test_client.post(
            "/api/user-files/uploads",
            params={"path": filename},
            content=content,
            headers={"Content-Type": "application/octet-stream"},
        )
        assert uploaded.status_code == 201

        created = files_test_client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={"kind": "file", "file_path": filename},
        )

        assert created.status_code == 400, created.text
        assert created.json()["code"] == "invalid_input"
        assert created.json()["message"] == "User file could not be loaded"


def test_derived_nodes_share_one_creation_contract_and_preview_is_read_only(
    tmp_path: Path,
) -> None:
    """Every transformation creates a child; preview never advances revision."""

    settings = Settings(
        data_root=tmp_path,
        multi_user=False,
        session_cookie_secure=False,
        cors_allowed_origins=("http://testserver",),
        trusted_hosts=("testserver",),
    )
    with TestClient(
        create_app(settings, serve_frontend=False),
        base_url="http://testserver",
    ) as client:
        csrf = client.get("/api/session").json()["csrf_token"]
        unsafe = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
        assert (
            client.post(
                "/api/user-files/uploads",
                params={"path": "source.csv"},
                content=b"text,count\na,1\nb,2\nc,3\n",
                headers={**unsafe, "Content-Type": "application/octet-stream"},
            ).status_code
            == 201
        )
        workspace = client.post(
            "/api/workspaces",
            json={"name": "Derivations"},
            headers=unsafe,
        )
        workspace_id = workspace.json()["id"]
        assert (
            client.put(f"/api/workspaces/{workspace_id}/open", headers=unsafe).status_code
            == 200
        )
        source = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={"kind": "file", "file_path": "source.csv"},
            headers=unsafe,
        )
        source_id = source.json()["id"]
        assert source.json()["provenance"] == {"type": "source"}
        assert "operation" not in source.json()

        operation = {
            "kind": "filter",
            "source_node_id": source_id,
            "conditions": [{"column": "count", "operator": "gte", "value": 2}],
        }
        preview = client.post(
            f"/api/workspaces/{workspace_id}/nodes/previews",
            json=operation,
            params={"page": 1, "page_size": 10},
            headers=unsafe,
        )
        assert preview.status_code == 200
        assert preview.headers["etag"] == source.headers["etag"]
        assert pl.read_ipc_stream(BytesIO(preview.content)).to_dicts() == [
            {"text": "b", "count": 2},
            {"text": "c", "count": 3},
        ]

        derived = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json=operation,
            headers=unsafe,
        )
        assert derived.status_code == 201
        assert derived.json()["parent_ids"] == [source_id]
        assert derived.json()["provenance"]["operation"]["kind"] == "filter"
        assert derived.json()["derivation_description"].startswith("filter of ")
        assert "operation" not in derived.json()
        assert derived.headers["etag"] != preview.headers["etag"]
        assert derived.headers["location"].endswith(f"/nodes/{derived.json()['id']}")

        next_command = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={"kind": "clone", "source_node_id": source_id},
            headers=unsafe,
        )
        assert next_command.status_code == 201
        assert next_command.headers["etag"] != derived.headers["etag"]


def test_derivation_preview_reports_safe_operation_errors(tmp_path: Path) -> None:
    """Preview explains known failures and safely classifies other Polars errors."""

    settings = Settings(
        data_root=tmp_path,
        multi_user=False,
        session_cookie_secure=False,
        cors_allowed_origins=("http://testserver",),
        trusted_hosts=("testserver",),
    )
    with TestClient(
        create_app(settings, serve_frontend=False),
        base_url="http://testserver",
    ) as client:
        csrf = client.get("/api/session").json()["csrf_token"]
        unsafe = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
        for path, content in (
            ("tweets.csv", b"tweet_id,username\n1,alice\n"),
            ("candidates.csv", b"party,username\nExample Party,alice\n"),
        ):
            assert (
                client.post(
                    "/api/user-files/uploads",
                    params={"path": path},
                    content=content,
                    headers={**unsafe, "Content-Type": "application/octet-stream"},
                ).status_code
                == 201
            )

        workspace = client.post(
            "/api/workspaces",
            json={"name": "Join validation"},
            headers=unsafe,
        )
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
            for path in ("tweets.csv", "candidates.csv")
        ]

        preview = client.post(
            f"/api/workspaces/{workspace_id}/nodes/previews",
            json={
                "kind": "join",
                "left_node_id": node_ids[0],
                "right_node_id": node_ids[1],
                "left_on": "tweet_id",
                "right_on": "party",
                "how": "left",
            },
            headers=unsafe,
        )

        assert preview.status_code == 400
        assert preview.headers["access-control-allow-origin"] == "http://testserver"
        assert preview.headers["x-request-id"] == preview.json()["request_id"]
        assert preview.json()["code"] == "invalid_input"
        assert preview.json()["message"] == (
            'Join columns have incompatible data types: "tweet_id" is integer (Int64), '
            'but "party" is string. Choose columns with the same data type or cast one '
            "column first."
        )

        other_polars_error = client.post(
            f"/api/workspaces/{workspace_id}/nodes/previews",
            json={
                "kind": "expression",
                "source_node_id": node_ids[0],
                "context": "with_columns",
                "expressions": [
                    {
                        "alias": "username_as_integer",
                        "expression": {
                            "op": "cast",
                            "operand": {"op": "column", "name": "username"},
                            "dtype": "integer",
                            "strict": True,
                        },
                    }
                ],
            },
            headers=unsafe,
        )

        assert other_polars_error.status_code == 400
        assert other_polars_error.json()["code"] == "invalid_input"
        assert other_polars_error.json()["message"] == (
            "The Data Block operation could not be applied to the selected data"
        )
        assert "alice" not in other_polars_error.text


def test_data_block_edits_preserve_identity_history_and_frozen_descendants(
    tmp_path: Path,
) -> None:
    settings = Settings(
        data_root=tmp_path,
        multi_user=False,
        session_cookie_secure=False,
        cors_allowed_origins=("http://testserver",),
        trusted_hosts=("testserver",),
    )
    with TestClient(
        create_app(settings, serve_frontend=False),
        base_url="http://testserver",
    ) as client:
        csrf = client.get("/api/session").json()["csrf_token"]
        unsafe = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
        assert (
            client.post(
                "/api/user-files/uploads",
                params={"path": "editable.csv"},
                content=b"text,count,dropme\nhello,1,x\nworld,2,y\n",
                headers={**unsafe, "Content-Type": "application/octet-stream"},
            ).status_code
            == 201
        )
        workspace = client.post(
            "/api/workspaces",
            json={"name": "Editable"},
            headers=unsafe,
        )
        workspace_id = workspace.json()["id"]
        assert (
            client.put(f"/api/workspaces/{workspace_id}/open", headers=unsafe).status_code
            == 200
        )
        source = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={"kind": "file", "file_path": "editable.csv"},
            headers=unsafe,
        )
        source_id = source.json()["id"]
        assert source.json()["can_undo"] is False
        assert source.json()["can_redo"] is False
        selected_document = client.patch(
            f"/api/workspaces/{workspace_id}/nodes/{source_id}",
            json={"document": "text"},
            headers=unsafe,
        )
        assert selected_document.status_code == 200

        empty_undo = client.post(
            f"/api/workspaces/{workspace_id}/nodes/{source_id}/undo",
            headers=unsafe,
        )
        assert empty_undo.status_code == 409
        assert empty_undo.json()["code"] == "resource_conflict"

        child = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={"kind": "clone", "source_node_id": source_id},
            headers=unsafe,
        )
        child_id = child.json()["id"]
        assert child.json()["can_undo"] is False
        assert child.json()["can_redo"] is False
        child_rows_before = client.post(
            f"/api/workspaces/{workspace_id}/sql",
            json={
                "mode": "query",
                "node_ids": [child_id],
                "sql": f'SELECT * FROM "{child_id}"',
            },
            headers=unsafe,
        ).content

        edits = [
            {"kind": "cast", "column": "count", "target_type": "string"},
            {
                "kind": "rename_column",
                "column": "count",
                "new_name": "score",
            },
            {"kind": "delete_column", "column": "dropme"},
            {
                "kind": "filter",
                    "conditions": [
                        {"column": "score", "operator": "contains", "value": "2"}
                    ],
                },
            {
                "kind": "replace",
                "source_column": "text",
                "pattern": "world",
                "replacement": "earth",
                "output_column": "clean_text",
            },
            {
                "kind": "expression",
                "context": "with_columns",
                "expressions": [
                    {
                        "alias": "upper_text",
                        "expression": {
                            "op": "uppercase",
                            "operand": {"op": "column", "name": "text"},
                        },
                    }
                ],
            },
        ]
        previous_etag = child.headers["etag"]
        for edit in edits:
            edited = client.post(
                f"/api/workspaces/{workspace_id}/nodes/{source_id}/edits",
                json=edit,
                headers=unsafe,
            )
            assert edited.status_code == 200, edited.text
            assert edited.json()["id"] == source_id
            assert edited.json()["provenance"] == {"type": "source"}
            assert edited.json()["can_undo"] is True
            assert edited.json()["can_redo"] is False
            assert edited.headers["etag"] != previous_etag
            previous_etag = edited.headers["etag"]
            nodes = client.get(f"/api/workspaces/{workspace_id}/nodes").json()
            assert [node["id"] for node in nodes] == [source_id, child_id]

        child_rows_after = client.post(
            f"/api/workspaces/{workspace_id}/sql",
            json={
                "mode": "query",
                "node_ids": [child_id],
                "sql": f'SELECT * FROM "{child_id}"',
            },
            headers=unsafe,
        ).content
        assert child_rows_after == child_rows_before

        undone = client.post(
            f"/api/workspaces/{workspace_id}/nodes/{source_id}/undo",
            headers=unsafe,
        )
        assert undone.status_code == 200
        assert undone.json()["can_undo"] is True
        assert undone.json()["can_redo"] is True
        undone_schema = pl.read_ipc_stream(
            BytesIO(
                client.get(
                    f"/api/workspaces/{workspace_id}/nodes/{source_id}/schema"
                ).content
            )
        ).schema
        assert "upper_text" not in undone_schema

        redone = client.post(
            f"/api/workspaces/{workspace_id}/nodes/{source_id}/redo",
            headers=unsafe,
        )
        assert redone.status_code == 200
        assert redone.json()["can_redo"] is False
        assert "upper_text" in pl.read_ipc_stream(
            BytesIO(
                client.get(
                    f"/api/workspaces/{workspace_id}/nodes/{source_id}/schema"
                ).content
            )
        ).schema

        renamed_document = client.post(
            f"/api/workspaces/{workspace_id}/nodes/{source_id}/edits",
            json={
                "kind": "rename_column",
                "column": "text",
                "new_name": "body",
            },
            headers=unsafe,
        )
        assert renamed_document.status_code == 200
        assert renamed_document.json()["document"] == "body"
        deleted_document = client.post(
            f"/api/workspaces/{workspace_id}/nodes/{source_id}/edits",
            json={"kind": "delete_column", "column": "body"},
            headers=unsafe,
        )
        assert deleted_document.status_code == 200
        assert deleted_document.json()["document"] is None

        assert (
            client.delete(
                f"/api/workspaces/{workspace_id}/open",
                headers=unsafe,
            ).status_code
            == 204
        )
        assert (
            client.put(f"/api/workspaces/{workspace_id}/open", headers=unsafe).status_code
            == 200
        )
        reopened = client.get(
            f"/api/workspaces/{workspace_id}/nodes/{source_id}"
        ).json()
        assert reopened["can_undo"] is False
        assert reopened["can_redo"] is False
        assert "upper_text" in pl.read_ipc_stream(
            BytesIO(
                client.get(
                    f"/api/workspaces/{workspace_id}/nodes/{source_id}/schema"
                ).content
            )
        ).schema
        no_op_etag = client.get(
            f"/api/workspaces/{workspace_id}/nodes/{source_id}"
        ).headers["etag"]
        no_op_cast = client.post(
            f"/api/workspaces/{workspace_id}/nodes/{source_id}/edits",
            json={
                "kind": "cast",
                "column": "score",
                "target_type": "string",
            },
            headers=unsafe,
        )
        assert no_op_cast.status_code == 200
        assert no_op_cast.headers["etag"] == no_op_etag
        assert no_op_cast.json()["can_undo"] is False
        assert no_op_cast.json()["can_redo"] is False
        no_op_edit = client.post(
            f"/api/workspaces/{workspace_id}/nodes/{source_id}/edits",
            json={
                "kind": "rename_column",
                "column": "score",
                "new_name": "score",
            },
            headers=unsafe,
        )
        assert no_op_edit.status_code == 200
        assert no_op_edit.headers["etag"] == no_op_etag
        assert no_op_edit.json()["can_undo"] is False
        assert no_op_edit.json()["can_redo"] is False

        cast_creation = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={
                "kind": "cast",
                "source_node_id": source_id,
                "column": "score",
                "target_type": "integer",
            },
            headers=unsafe,
        )
        assert cast_creation.status_code == 422
        sample_edit = client.post(
            f"/api/workspaces/{workspace_id}/nodes/{source_id}/edits",
            json={"kind": "slice", "mode": "slice", "offset": 0, "length": 1},
            headers=unsafe,
        )
        assert sample_edit.status_code == 422


def test_manual_annotation_edits_share_node_history_and_persistence(
    tmp_path: Path,
) -> None:
    settings = Settings(
        data_root=tmp_path,
        multi_user=False,
        session_cookie_secure=False,
        cors_allowed_origins=("http://testserver",),
        trusted_hosts=("testserver",),
    )
    with TestClient(
        create_app(settings, serve_frontend=False),
        base_url="http://testserver",
    ) as client:
        csrf = client.get("/api/session").json()["csrf_token"]
        unsafe = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
        assert (
            client.post(
                "/api/user-files/uploads",
                params={"path": "annotations.csv"},
                content=(
                    b"class,description,annotation,code\n"
                    b"support,Supportive,,10\n"
                    b"critical,Critical,,20\n"
                ),
                headers={**unsafe, "Content-Type": "application/octet-stream"},
            ).status_code
            == 201
        )
        workspace_id = client.post(
            "/api/workspaces",
            json={"name": "Manual annotation"},
            headers=unsafe,
        ).json()["id"]
        assert (
            client.put(f"/api/workspaces/{workspace_id}/open", headers=unsafe).status_code
            == 200
        )
        node_id = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={"kind": "file", "file_path": "annotations.csv"},
            headers=unsafe,
        ).json()["id"]

        cell = client.post(
            f"/api/workspaces/{workspace_id}/nodes/{node_id}/edits",
            json={
                "kind": "set_cell",
                "column": "annotation",
                "row_index": 1,
                "value": "support",
            },
            headers=unsafe,
        )
        assert cell.status_code == 200, cell.text
        assert cell.json()["can_undo"] is True

        classes = client.post(
            f"/api/workspaces/{workspace_id}/nodes/{node_id}/edits",
            json={
                "kind": "annotation_classes",
                "class_column": "class",
                "description_column": "description",
                "rows": [
                    {"class": "support", "description": "Supports"},
                    {"class": "critical", "description": "Criticises"},
                    {"class": "neutral", "description": "Neither"},
                ],
            },
            headers=unsafe,
        )
        assert classes.status_code == 200, classes.text
        assert classes.json()["can_undo"] is True
        rows = client.post(
            f"/api/workspaces/{workspace_id}/sql",
            json={
                "mode": "query",
                "node_ids": [node_id],
                "sql": f'SELECT * FROM "{node_id}"',
            },
            headers=unsafe,
        )
        assert pl.read_ipc_stream(BytesIO(rows.content)).to_dicts() == [
            {
                "class": "support",
                "description": "Supports",
                "annotation": None,
                "code": 10,
            },
            {
                "class": "critical",
                "description": "Criticises",
                "annotation": "support",
                "code": 20,
            },
            {
                "class": "neutral",
                "description": "Neither",
                "annotation": None,
                "code": None,
            },
        ]

        assert (
            client.post(
                f"/api/workspaces/{workspace_id}/nodes/{node_id}/undo",
                headers=unsafe,
            ).status_code
            == 200
        )
        assert (
            client.delete(
                f"/api/workspaces/{workspace_id}/open",
                headers=unsafe,
            ).status_code
            == 204
        )
        assert (
            client.put(f"/api/workspaces/{workspace_id}/open", headers=unsafe).status_code
            == 200
        )
        reopened = client.get(
            f"/api/workspaces/{workspace_id}/nodes/{node_id}"
        ).json()
        assert reopened["can_undo"] is False
        assert reopened["can_redo"] is False
