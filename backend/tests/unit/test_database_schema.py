"""Exact SQLite schema marker and structural validation."""

from pathlib import Path

import aiosqlite
import pytest

from ldaca_wordflow.infrastructure.database import Database


@pytest.mark.anyio
async def test_fresh_database_is_created_at_exact_schema_version(
    tmp_path: Path,
) -> None:
    database = Database(tmp_path / "users.db")
    await database.initialize()

    async with aiosqlite.connect(database.path) as connection:
        version = await (await connection.execute("PRAGMA user_version")).fetchone()
        columns = list(
            await (await connection.execute('PRAGMA table_info("users")')).fetchall()
        )
    assert version == (6,)
    assert columns[-1][1:5] == (
        "storage_quota_bytes",
        "INTEGER",
        0,
        "32212254720",
    )


@pytest.mark.anyio
async def test_user_storage_quota_defaults_nullable_and_positive_only(
    tmp_path: Path,
) -> None:
    database = Database(tmp_path / "users.db")
    await database.initialize()

    async with aiosqlite.connect(database.path) as connection:
        await connection.execute(
            "INSERT INTO users (id,email,name,is_active,created_at) VALUES (?,?,?,?,?)",
            ("hosted", "hosted@example.test", "Hosted", 1, "now"),
        )
        await connection.execute(
            "INSERT INTO users "
            "(id,email,name,is_active,created_at,storage_quota_bytes) "
            "VALUES (?,?,?,?,?,NULL)",
            ("local", "local@example.test", "Local", 1, "now"),
        )
        await connection.commit()

        rows = await (
            await connection.execute(
                "SELECT id, storage_quota_bytes FROM users ORDER BY id"
            )
        ).fetchall()
        assert rows == [("hosted", 30 * 1024**3), ("local", None)]

        for invalid in (0, -1):
            with pytest.raises(aiosqlite.IntegrityError):
                await connection.execute(
                    "INSERT INTO users "
                    "(id,email,name,is_active,created_at,storage_quota_bytes) "
                    "VALUES (?,?,?,?,?,?)",
                    (
                        f"invalid-{invalid}",
                        f"invalid-{invalid}@example.test",
                        "Invalid",
                        1,
                        "now",
                        invalid,
                    ),
                )
            await connection.rollback()


@pytest.mark.anyio
async def test_existing_v1_marker_is_rejected_without_relabeling(
    tmp_path: Path,
) -> None:
    database = Database(tmp_path / "users.db")
    async with aiosqlite.connect(database.path) as connection:
        await connection.execute("CREATE TABLE users (id TEXT PRIMARY KEY)")
        await connection.execute("PRAGMA user_version = 1")
        await connection.commit()

    with pytest.raises(RuntimeError, match="schema version"):
        await database.initialize()

    async with aiosqlite.connect(database.path) as connection:
        version = await (await connection.execute("PRAGMA user_version")).fetchone()
    assert version == (1,)


@pytest.mark.anyio
async def test_wrong_column_structure_is_rejected_at_current_version(
    tmp_path: Path,
) -> None:
    database = Database(tmp_path / "users.db")
    await database.initialize()
    async with aiosqlite.connect(database.path) as connection:
        await connection.execute("ALTER TABLE users RENAME TO users_old")
        await connection.execute("CREATE TABLE users (id INTEGER PRIMARY KEY)")
        await connection.commit()

    with pytest.raises(RuntimeError, match="database (table set|schema)"):
        await database.initialize()


@pytest.mark.anyio
async def test_missing_storage_quota_constraint_is_rejected(
    tmp_path: Path,
) -> None:
    database = Database(tmp_path / "users.db")
    await database.initialize()
    async with aiosqlite.connect(database.path) as connection:
        row = await (
            await connection.execute(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
            )
        ).fetchone()
        assert row is not None
        altered = str(row[0]).replace(
            "\n        CHECK (storage_quota_bytes IS NULL OR storage_quota_bytes > 0)",
            "",
        )
        assert altered != row[0]
        await connection.execute("PRAGMA writable_schema = ON")
        await connection.execute(
            "UPDATE sqlite_master SET sql = ? WHERE type = 'table' AND name = 'users'",
            (altered,),
        )
        await connection.execute("PRAGMA writable_schema = OFF")
        await connection.commit()

    with pytest.raises(RuntimeError, match="storage quota constraint"):
        await database.initialize()


@pytest.mark.anyio
async def test_google_credential_consumption_is_atomic_and_one_use(
    tmp_path: Path,
) -> None:
    """Concurrent callbacks cannot consume the same verified credential twice."""

    database = Database(tmp_path / "users.db")
    await database.initialize()
    assert await database.consume_google_credential("hash", 4_102_444_800, "now")
    assert not await database.consume_google_credential("hash", 4_102_444_800, "later")


@pytest.mark.anyio
async def test_oauth_transaction_is_hashed_and_consumed_exactly_once(
    tmp_path: Path,
) -> None:
    database = Database(tmp_path / "users.db")
    await database.initialize()
    await database.create_oauth_transaction(
        state_hash="state-hash",
        provider="cilogon",
        code_verifier="verifier",
        return_to="/workspace",
        expires_at=4_102_444_800,
        created_at="now",
    )

    assert await database.consume_oauth_transaction(
        state_hash="state-hash",
        provider="cilogon",
    ) == ("verifier", "/workspace")
    assert (
        await database.consume_oauth_transaction(
            state_hash="state-hash",
            provider="cilogon",
        )
        is None
    )
