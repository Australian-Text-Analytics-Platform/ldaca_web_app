"""Canonical HTTP contract for workspace resources."""

from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
import zipfile

from fastapi.testclient import TestClient
import pytest

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


def _unsafe_headers(client: TestClient) -> dict[str, str]:
    csrf = client.get("/api/session").json()["csrf_token"]
    return {"Origin": "http://testserver", "X-CSRF-Token": csrf}


def test_workspace_resource_uses_explicit_open_and_server_ordered_mutations(
    tmp_path: Path,
) -> None:
    with _client(tmp_path) as client:
        unsafe = _unsafe_headers(client)
        created = client.post(
            "/api/workspaces",
            json={"name": "Research", "description": "Initial"},
            headers=unsafe,
        )

        assert created.status_code == 201
        workspace = created.json()
        workspace_id = workspace["id"]
        assert created.headers["Location"] == f"/api/workspaces/{workspace_id}"
        assert created.headers["ETag"] == '"1"'
        assert workspace["revision"] == 1
        assert workspace["runtime_state"] == "closed"

        detail = client.get(f"/api/workspaces/{workspace_id}")
        assert detail.status_code == 200
        assert detail.headers["ETag"] == '"1"'
        assert detail.json() == workspace

        closed_mutation = client.patch(
            f"/api/workspaces/{workspace_id}",
            json={"description": "next"},
            headers=unsafe,
        )
        assert closed_mutation.status_code == 409
        assert closed_mutation.json()["code"] == "workspace_not_open"

        opened = client.put(
            f"/api/workspaces/{workspace_id}/open",
            headers=unsafe,
        )
        assert opened.status_code == 200
        assert opened.json()["runtime_state"] == "open"

        repeated_open = client.put(
            f"/api/workspaces/{workspace_id}/open",
            headers=unsafe,
        )
        assert repeated_open.status_code == 200
        assert repeated_open.json()["revision"] == 1

        updated = client.patch(
            f"/api/workspaces/{workspace_id}",
            headers=unsafe,
            json={"description": "Updated"},
        )
        assert updated.status_code == 200
        assert updated.headers["ETag"] == '"2"'
        assert updated.json()["revision"] == 2
        assert updated.json()["description"] == "Updated"

        no_op = client.patch(
            f"/api/workspaces/{workspace_id}",
            headers=unsafe,
            json={"description": "Updated"},
        )
        assert no_op.status_code == 200
        assert no_op.headers["ETag"] == '"2"'
        assert no_op.json()["revision"] == 2

        empty_patch = client.patch(
            f"/api/workspaces/{workspace_id}",
            headers=unsafe,
            json={},
        )
        assert empty_patch.status_code == 422

        same_order = client.put(
            f"/api/workspaces/{workspace_id}/nodes/order",
            headers=unsafe,
            json={"ordered_ids": []},
        )
        assert same_order.status_code == 200
        assert same_order.headers["ETag"] == '"2"'

        exported = client.get(f"/api/workspaces/{workspace_id}/archive")
        assert exported.status_code == 200
        assert exported.headers["etag"] == '"2"'
        with zipfile.ZipFile(BytesIO(exported.content)) as archive:
            assert "workspace/workspace.json" in archive.namelist()
            assert not any(name.endswith(".plbin") for name in archive.namelist())

        closed = client.delete(
            f"/api/workspaces/{workspace_id}/open",
            headers=unsafe,
        )
        assert closed.status_code == 204
        assert closed.content == b""
        repeated_close = client.delete(
            f"/api/workspaces/{workspace_id}/open",
            headers=unsafe,
        )
        assert repeated_close.status_code == 204
        assert client.get(f"/api/workspaces/{workspace_id}").json()[
            "runtime_state"
        ] == "closed"
        assert client.get(f"/api/workspaces/{workspace_id}/archive").json()[
            "code"
        ] == "workspace_not_open"


def test_workspace_in_use_preserves_current_open_workspace(tmp_path: Path) -> None:
    with _client(tmp_path) as holder, _client(tmp_path) as contender:
        holder_headers = _unsafe_headers(holder)
        contender_headers = _unsafe_headers(contender)
        target = holder.post(
            "/api/workspaces",
            json={"name": "Externally open"},
            headers=holder_headers,
        ).json()
        current = contender.post(
            "/api/workspaces",
            json={"name": "Locally open"},
            headers=contender_headers,
        ).json()
        assert holder.put(
            f"/api/workspaces/{target['id']}/open",
            headers=holder_headers,
        ).status_code == 200
        assert contender.put(
            f"/api/workspaces/{current['id']}/open",
            headers=contender_headers,
        ).status_code == 200

        conflict = contender.put(
            f"/api/workspaces/{target['id']}/open",
            headers=contender_headers,
        )

        assert conflict.status_code == 409
        assert conflict.json()["code"] == "workspace_in_use"
        assert conflict.json()["message"] == (
            "Workspace is open in another Wordflow backend process"
        )
        assert contender.get(f"/api/workspaces/{current['id']}").json()[
            "runtime_state"
        ] == "open"
        delete_conflict = contender.delete(
            f"/api/workspaces/{target['id']}",
            headers=contender_headers,
        )
        assert delete_conflict.status_code == 409
        assert delete_conflict.json()["code"] == "workspace_in_use"

        assert holder.delete(
            f"/api/workspaces/{target['id']}/open",
            headers=holder_headers,
        ).status_code == 204
        assert contender.put(
            f"/api/workspaces/{target['id']}/open",
            headers=contender_headers,
        ).status_code == 200
        assert contender.get(f"/api/workspaces/{current['id']}").json()[
            "runtime_state"
        ] == "closed"


def test_unsafe_workspace_lock_entry_has_distinct_safe_error(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        unsafe = _unsafe_headers(client)
        workspace_id = client.post(
            "/api/workspaces",
            json={"name": "Unsafe registry"},
            headers=unsafe,
        ).json()["id"]
        outside = tmp_path / "outside.txt"
        outside.write_text("do not modify", encoding="utf-8")
        lock_path = tmp_path / "workspaces" / ".locks" / f"{workspace_id}.lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            lock_path.symlink_to(outside)
        except OSError as exc:
            pytest.skip(f"symlinks are unavailable: {exc}")

        response = client.put(
            f"/api/workspaces/{workspace_id}/open",
            headers=unsafe,
        )

        assert response.status_code == 500
        assert response.json()["code"] == "workspace_lock_unavailable"
        assert response.json()["message"] == "Workspace locking is unavailable"
        assert outside.read_text(encoding="utf-8") == "do not modify"


def test_workspace_names_are_display_labels_and_storage_remains_uuid_keyed(
    tmp_path: Path,
) -> None:
    with _client(tmp_path) as client:
        unsafe = _unsafe_headers(client)
        created = client.post(
            "/api/workspaces",
            json={"name": "  Fiscal 2025/26  "},
            headers=unsafe,
        )

        assert created.status_code == 201
        workspace_id = created.json()["id"]
        assert created.json()["name"] == "Fiscal 2025/26"
        assert (
            client.put(f"/api/workspaces/{workspace_id}/open", headers=unsafe).status_code
            == 200
        )

        renamed = client.patch(
            f"/api/workspaces/{workspace_id}",
            json={"name": r"Draft\..\Final"},
            headers=unsafe,
        )
        assert renamed.status_code == 200
        assert renamed.json()["name"] == r"Draft\..\Final"

        assert (
            client.delete(f"/api/workspaces/{workspace_id}/open", headers=unsafe).status_code
            == 204
        )
        reopened = client.put(f"/api/workspaces/{workspace_id}/open", headers=unsafe)
        assert reopened.status_code == 200
        assert reopened.json()["name"] == r"Draft\..\Final"
        assert client.get("/api/workspaces").json()[0]["name"] == r"Draft\..\Final"

        workspace_entries = sorted(
            path.name
            for path in (tmp_path / "workspaces").iterdir()
            if not path.name.startswith(".")
        )
        assert workspace_entries == [workspace_id]


@pytest.mark.parametrize(
    ("name", "expected_status"),
    [
        ("", 422),
        ("   ", 400),
        ("Control\x7fName", 400),
        ("x" * 501, 422),
    ],
)
def test_workspace_name_validation_retains_non_path_safety_limits(
    tmp_path: Path,
    name: str,
    expected_status: int,
) -> None:
    with _client(tmp_path) as client:
        response = client.post(
            "/api/workspaces",
            json={"name": name},
            headers=_unsafe_headers(client),
        )

        assert response.status_code == expected_status


def test_workspace_archive_round_trip_preserves_display_name_and_safe_filename(
    tmp_path: Path,
) -> None:
    display_name = r"Archive / Draft\..\Final"
    with _client(tmp_path) as client:
        unsafe = _unsafe_headers(client)
        created = client.post(
            "/api/workspaces",
            json={"name": display_name},
            headers=unsafe,
        ).json()
        assert (
            client.put(f"/api/workspaces/{created['id']}/open", headers=unsafe).status_code
            == 200
        )

        exported = client.get(f"/api/workspaces/{created['id']}/archive")

        assert exported.status_code == 200
        disposition = exported.headers["content-disposition"]
        assert "/" not in disposition
        assert "\\" not in disposition
        assert ".." not in disposition
        assert ".zip" in disposition
        with zipfile.ZipFile(BytesIO(exported.content)) as archive:
            manifest = json.loads(archive.read("workspace/workspace.json"))
        assert manifest["workspace"]["name"] == display_name

        imported = client.post(
            "/api/workspaces/imports?filename=display-label.zip",
            content=exported.content,
            headers={**unsafe, "Content-Type": "application/octet-stream"},
        )

        assert imported.status_code == 201
        assert imported.json()["name"] == display_name


def test_workspace_patch_can_explicitly_clear_nullable_description(
    tmp_path: Path,
) -> None:
    with _client(tmp_path) as client:
        unsafe = _unsafe_headers(client)
        created = client.post(
            "/api/workspaces",
            json={"name": "Clear metadata", "description": "temporary"},
            headers=unsafe,
        )
        workspace_id = created.json()["id"]
        assert (
            client.put(f"/api/workspaces/{workspace_id}/open", headers=unsafe).status_code
            == 200
        )

        cleared = client.patch(
            f"/api/workspaces/{workspace_id}",
            json={"description": None},
            headers=unsafe,
        )
        assert cleared.status_code == 200
        assert cleared.headers["etag"] == '"2"'
        assert cleared.json()["description"] == ""

        repeated = client.patch(
            f"/api/workspaces/{workspace_id}",
            json={"description": None},
            headers=unsafe,
        )
        assert repeated.status_code == 200
        assert repeated.headers["etag"] == '"2"'


def test_opening_a_workspace_closes_the_previous_idle_workspace(
    tmp_path: Path,
) -> None:
    with _client(tmp_path) as client:
        unsafe = _unsafe_headers(client)
        first = client.post(
            "/api/workspaces",
            json={"name": "First"},
            headers=unsafe,
        ).json()
        second = client.post(
            "/api/workspaces",
            json={"name": "Second"},
            headers=unsafe,
        ).json()

        assert (
            client.put(
                f"/api/workspaces/{first['id']}/open",
                headers=unsafe,
            ).status_code
            == 200
        )
        assert (
            client.put(
                f"/api/workspaces/{second['id']}/open",
                headers=unsafe,
            ).status_code
            == 200
        )

        states = {
            workspace["id"]: workspace["runtime_state"]
            for workspace in client.get("/api/workspaces").json()
        }
        assert states == {first["id"]: "closed", second["id"]: "open"}


def test_workspace_delete_is_empty_204_and_removed_action_routes_stay_absent(
    tmp_path: Path,
) -> None:
    with _client(tmp_path) as client:
        unsafe = _unsafe_headers(client)
        created = client.post(
            "/api/workspaces",
            json={"name": "Delete me"},
            headers=unsafe,
        )
        workspace_id = created.json()["id"]

        deleted = client.delete(
            f"/api/workspaces/{workspace_id}",
            headers=unsafe,
        )
        assert deleted.status_code == 204
        assert deleted.content == b""
        assert client.get(f"/api/workspaces/{workspace_id}").status_code == 404

        assert client.get("/api/users/me/current-workspace").status_code == 404
        assert (
            client.post(
                f"/api/workspaces/{workspace_id}/unload", headers=unsafe
            ).status_code
            == 404
        )
        assert (
            client.post(
                f"/api/workspaces/{workspace_id}/save", headers=unsafe
            ).status_code
            == 404
        )
        assert client.get(f"/api/workspaces/{workspace_id}/graph").status_code == 404


def test_corrupt_workspace_is_catalogued_but_directly_reported_and_deletable(
    tmp_path: Path,
) -> None:
    with _client(tmp_path) as client:
        unsafe = _unsafe_headers(client)
        created = client.post(
            "/api/workspaces",
            json={"name": "Corrupt me"},
            headers=unsafe,
        )
        workspace_id = created.json()["id"]
        workspace_path = tmp_path / "workspaces" / workspace_id
        (workspace_path / "workspace.json").write_text(
            "not json",
            encoding="utf-8",
        )

        listed = client.get("/api/workspaces")
        assert listed.status_code == 200
        assert listed.json() == [
            {
                "availability": "unavailable",
                "id": workspace_id,
                "reason": "corrupt_snapshot",
                "message": "Workspace data is corrupt.",
                "name": None,
                "description": None,
                "created_at": None,
                "modified_at": None,
                "stored_data_schema_version": None,
                "supported_data_schema_version": None,
            }
        ]

        direct = client.get(f"/api/workspaces/{workspace_id}")
        assert direct.status_code == 500
        assert direct.json()["code"] == "workspace_corrupt"
        assert direct.json()["details"] == {"workspace_id": workspace_id}

        deleted = client.delete(
            f"/api/workspaces/{workspace_id}",
            headers=unsafe,
        )
        assert deleted.status_code == 204
        assert not workspace_path.exists()


def test_incompatible_workspace_lists_metadata_and_supports_archival_download(
    tmp_path: Path,
) -> None:
    with _client(tmp_path) as client:
        unsafe = _unsafe_headers(client)
        created = client.post(
            "/api/workspaces",
            json={"name": "Archived workshop", "description": "Workshop notes"},
            headers=unsafe,
        ).json()
        workspace_id = created["id"]
        workspace_path = tmp_path / "workspaces" / workspace_id
        metadata_path = workspace_path / "workspace.json"
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        payload["workspace_metadata"]["data_schema_version"] = 2
        payload["workspace_metadata"]["created_at"] = "2024-01-01T00:00:00+00:00"
        payload["workspace_metadata"]["modified_at"] = "2024-01-02T00:00:00+00:00"
        metadata_path.write_text(json.dumps(payload), encoding="utf-8")

        listed = client.get("/api/workspaces")
        assert listed.status_code == 200
        assert listed.json() == [
            {
                "availability": "unavailable",
                "id": workspace_id,
                "reason": "incompatible_format",
                "message": (
                    "Workspace data schema 2 is incompatible with supported data schema 1."
                ),
                "name": "Archived workshop",
                "description": "Workshop notes",
                "created_at": "2024-01-01T00:00:00+00:00",
                "modified_at": "2024-01-02T00:00:00+00:00",
                "stored_data_schema_version": 2,
                "supported_data_schema_version": 1,
            }
        ]

        exported = client.get(f"/api/workspaces/{workspace_id}/archive")
        assert exported.status_code == 200
        with zipfile.ZipFile(BytesIO(exported.content)) as archive:
            assert archive.namelist() == ["workspace/workspace.json"]
            assert archive.read("workspace/workspace.json") == metadata_path.read_bytes()
            assert "workspace/access.json" not in archive.namelist()


def test_archive_import_gets_fresh_identity_owner_and_timestamps(
    tmp_path: Path,
) -> None:
    with _client(tmp_path) as client:
        unsafe = _unsafe_headers(client)
        created = client.post(
            "/api/workspaces",
            json={"name": "Original"},
            headers=unsafe,
        ).json()
        assert created["created_at"] == created["modified_at"]
        assert created["created_at"] is not None
        assert (
            client.put(
                f"/api/workspaces/{created['id']}/open",
                headers=unsafe,
            ).status_code
            == 200
        )
        exported = client.get(f"/api/workspaces/{created['id']}/archive")
        assert exported.status_code == 200

        rewritten = BytesIO()
        with (
            zipfile.ZipFile(BytesIO(exported.content)) as source,
            zipfile.ZipFile(rewritten, "w", compression=zipfile.ZIP_DEFLATED) as target,
        ):
            for name in source.namelist():
                content = source.read(name)
                if name == "workspace/workspace.json":
                    manifest = json.loads(content)
                    manifest["workspace"]["created_at"] = "2000-01-01T00:00:00Z"
                    manifest["workspace"]["modified_at"] = "2001-01-01T00:00:00Z"
                    content = json.dumps(manifest).encode("utf-8")
                target.writestr(name, content)

        imported = client.post(
            "/api/workspaces/imports?filename=copy.zip",
            content=rewritten.getvalue(),
            headers={**unsafe, "Content-Type": "application/octet-stream"},
        )

        assert imported.status_code == 201
        resource = imported.json()
        assert resource["id"] != created["id"]
        assert resource["runtime_state"] == "closed"
        assert resource["created_at"] == resource["modified_at"]
        assert resource["created_at"] not in {
            "2000-01-01T00:00:00Z",
            "2001-01-01T00:00:00Z",
        }
        assert imported.headers["Location"] == f"/api/workspaces/{resource['id']}"
        access = json.loads(
            (tmp_path / "workspaces" / resource["id"] / "access.json").read_text(
                encoding="utf-8"
            )
        )
        assert access == {"owner_id": "root"}
