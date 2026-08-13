"""Runtime-owned SQLite adapter for the single authentication schema.

Used only by lifespan services. Connections are operation-scoped, foreign keys
are enabled on every connection, and no URL override or module-level database
exists. Startup creates a new schema or validates the current schema exactly; it
does not interpret, copy, or silently mutate older layouts.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite

from .storage.durable_fs import fsync_directory, mkdir_durable

_CREATE_USERS = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    picture TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_login TEXT,
    storage_quota_bytes INTEGER DEFAULT 32212254720
        CHECK (storage_quota_bytes IS NULL OR storage_quota_bytes > 0)
)
"""

_CREATE_IDENTITIES = """
CREATE TABLE IF NOT EXISTS user_identities (
    issuer TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (issuer, subject),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
)
"""

_CREATE_SESSIONS = """
CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
)
"""

_CREATE_GOOGLE_LOGIN_CREDENTIALS = """
CREATE TABLE IF NOT EXISTS google_login_credentials (
    credential_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    consumed_at TEXT NOT NULL
)
"""

_CREATE_OAUTH_TRANSACTIONS = """
CREATE TABLE IF NOT EXISTS oauth_transactions (
    state_hash TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    return_to TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
)
"""

_SCHEMA_VERSION = 6
_EXPECTED_COLUMNS = {
    "users": [
        ("id", "TEXT", 0, None, 1),
        ("email", "TEXT", 1, None, 0),
        ("name", "TEXT", 1, None, 0),
        ("picture", "TEXT", 0, None, 0),
        ("is_active", "INTEGER", 1, "1", 0),
        ("created_at", "TEXT", 1, None, 0),
        ("last_login", "TEXT", 0, None, 0),
        ("storage_quota_bytes", "INTEGER", 0, "32212254720", 0),
    ],
    "user_identities": [
        ("issuer", "TEXT", 1, None, 1),
        ("subject", "TEXT", 1, None, 2),
        ("user_id", "TEXT", 1, None, 0),
        ("created_at", "TEXT", 1, None, 0),
    ],
    "user_sessions": [
        ("id", "TEXT", 0, None, 1),
        ("user_id", "TEXT", 1, None, 0),
        ("token_hash", "TEXT", 1, None, 0),
        ("csrf_hash", "TEXT", 1, None, 0),
        ("expires_at", "TEXT", 1, None, 0),
        ("created_at", "TEXT", 1, None, 0),
        ("revoked_at", "TEXT", 0, None, 0),
    ],
    "google_login_credentials": [
        ("credential_hash", "TEXT", 0, None, 1),
        ("expires_at", "INTEGER", 1, None, 0),
        ("consumed_at", "TEXT", 1, None, 0),
    ],
    "oauth_transactions": [
        ("state_hash", "TEXT", 0, None, 1),
        ("provider", "TEXT", 1, None, 0),
        ("code_verifier", "TEXT", 1, None, 0),
        ("return_to", "TEXT", 1, None, 0),
        ("expires_at", "INTEGER", 1, None, 0),
        ("created_at", "TEXT", 1, None, 0),
    ],
}


class Database:
    """One immutable SQLite target owned by a single application runtime."""

    def __init__(self, path: Path) -> None:
        self.path = path.expanduser().resolve(strict=False)

    @asynccontextmanager
    async def connection(self) -> AsyncIterator[aiosqlite.Connection]:
        """Yield a row-mapped, foreign-key-enabled transaction connection."""

        mkdir_durable(self.path.parent)
        connection = await aiosqlite.connect(self.path)
        connection.row_factory = aiosqlite.Row
        await connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
        finally:
            await connection.close()

    async def initialize(self) -> None:
        """Create a fresh schema or fail fast when an unsupported layout exists."""

        existed = self.path.exists()
        async with self.connection() as connection:
            await connection.execute("BEGIN IMMEDIATE")
            try:
                version = await _user_version(connection)
                tables = await _user_tables(connection)
                if not tables and version == 0:
                    await connection.execute(_CREATE_USERS)
                    await connection.execute(_CREATE_IDENTITIES)
                    await connection.execute(_CREATE_SESSIONS)
                    await connection.execute(_CREATE_GOOGLE_LOGIN_CREDENTIALS)
                    await connection.execute(_CREATE_OAUTH_TRANSACTIONS)
                    await connection.execute(
                        "CREATE INDEX idx_sessions_user ON user_sessions(user_id)"
                    )
                    await connection.execute(
                        "CREATE INDEX idx_sessions_expiry ON user_sessions(expires_at)"
                    )
                    await connection.execute(f"PRAGMA user_version = {_SCHEMA_VERSION}")
                elif version != _SCHEMA_VERSION:
                    raise RuntimeError("Unsupported database schema version")
                await _validate_schema(connection)
            except BaseException:
                await connection.rollback()
                raise
            await connection.commit()
        if not existed:
            fsync_directory(self.path.parent)

    async def get_storage_quota_bytes(self, user_id: str) -> int | None:
        """Read one current principal policy without caching operator updates."""

        async with self.connection() as connection:
            row = await (
                await connection.execute(
                    "SELECT storage_quota_bytes FROM users WHERE id = ?",
                    (user_id,),
                )
            ).fetchone()
        if row is None:
            raise RuntimeError("Authenticated principal is absent from storage policy")
        value = row["storage_quota_bytes"]
        return None if value is None else int(value)

    async def consume_google_credential(
        self,
        credential_hash: str,
        expires_at: int,
        consumed_at: str,
    ) -> bool:
        """Atomically consume one verified Google credential hash exactly once."""

        async with self.connection() as connection:
            await connection.execute("BEGIN IMMEDIATE")
            try:
                await connection.execute(
                    "DELETE FROM google_login_credentials WHERE expires_at < unixepoch()"
                )
                cursor = await connection.execute(
                    "INSERT OR IGNORE INTO google_login_credentials "
                    "(credential_hash, expires_at, consumed_at) VALUES (?, ?, ?)",
                    (credential_hash, expires_at, consumed_at),
                )
                consumed = cursor.rowcount == 1
            except BaseException:
                await connection.rollback()
                raise
            await connection.commit()
            return consumed

    async def create_oauth_transaction(
        self,
        *,
        state_hash: str,
        provider: str,
        code_verifier: str,
        return_to: str,
        expires_at: int,
        created_at: str,
    ) -> None:
        """Persist one opaque login transaction without storing its raw state."""

        async with self.connection() as connection:
            await connection.execute("BEGIN IMMEDIATE")
            try:
                await connection.execute(
                    "DELETE FROM oauth_transactions WHERE expires_at < unixepoch()"
                )
                await connection.execute(
                    "INSERT INTO oauth_transactions "
                    "(state_hash, provider, code_verifier, return_to, expires_at, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        state_hash,
                        provider,
                        code_verifier,
                        return_to,
                        expires_at,
                        created_at,
                    ),
                )
            except BaseException:
                await connection.rollback()
                raise
            await connection.commit()

    async def consume_oauth_transaction(
        self,
        *,
        state_hash: str,
        provider: str,
    ) -> tuple[str, str] | None:
        """Atomically delete and return one unexpired provider transaction."""

        async with self.connection() as connection:
            await connection.execute("BEGIN IMMEDIATE")
            try:
                await connection.execute(
                    "DELETE FROM oauth_transactions WHERE expires_at < unixepoch()"
                )
                row = await (
                    await connection.execute(
                        "SELECT code_verifier, return_to FROM oauth_transactions "
                        "WHERE state_hash = ? AND provider = ?",
                        (state_hash, provider),
                    )
                ).fetchone()
                if row is not None:
                    await connection.execute(
                        "DELETE FROM oauth_transactions WHERE state_hash = ?",
                        (state_hash,),
                    )
            except BaseException:
                await connection.rollback()
                raise
            await connection.commit()
            if row is None:
                return None
            return str(row[0]), str(row[1])


async def _user_version(connection: aiosqlite.Connection) -> int:
    row = await (await connection.execute("PRAGMA user_version")).fetchone()
    if row is None:
        raise RuntimeError("Database schema version is unavailable")
    return int(row[0])


async def _user_tables(connection: aiosqlite.Connection) -> set[str]:
    rows = await (
        await connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )
    ).fetchall()
    return {str(row[0]) for row in rows}


async def _table_columns(
    connection: aiosqlite.Connection,
    table: str,
) -> list[tuple[str, str, int, str | None, int]]:
    cursor = await connection.execute(f'PRAGMA table_info("{table}")')
    rows = await cursor.fetchall()
    return [
        (
            str(row["name"]),
            str(row["type"]).upper(),
            int(row["notnull"]),
            str(row["dflt_value"]) if row["dflt_value"] is not None else None,
            int(row["pk"]),
        )
        for row in rows
    ]


async def _validate_schema(connection: aiosqlite.Connection) -> None:
    if await _user_version(connection) != _SCHEMA_VERSION:
        raise RuntimeError("Unsupported database schema version")
    if await _user_tables(connection) != set(_EXPECTED_COLUMNS):
        raise RuntimeError("Unsupported database table set")
    for table, expected in _EXPECTED_COLUMNS.items():
        if await _table_columns(connection, table) != expected:
            raise RuntimeError(f"Unsupported {table} database schema")
    if not await _has_positive_nullable_storage_quota(connection):
        raise RuntimeError("Unsupported users storage quota constraint")
    for table in ("user_identities", "user_sessions"):
        rows = await (
            await connection.execute(f'PRAGMA foreign_key_list("{table}")')
        ).fetchall()
        foreign_keys = {
            (
                str(row["from"]),
                str(row["table"]),
                str(row["to"]),
                str(row["on_delete"]).upper(),
            )
            for row in rows
        }
        if foreign_keys != {("user_id", "users", "id", "CASCADE")}:
            raise RuntimeError(f"Unsupported {table} foreign keys")
    if not await _has_exact_index(connection, "users", ("email",), unique=True):
        raise RuntimeError("Unsupported users unique constraints")
    if not await _has_exact_index(
        connection,
        "user_sessions",
        ("token_hash",),
        unique=True,
    ):
        raise RuntimeError("Unsupported session unique constraints")
    for name, columns in (
        ("idx_sessions_user", ("user_id",)),
        ("idx_sessions_expiry", ("expires_at",)),
    ):
        if not await _has_named_index(connection, "user_sessions", name, columns):
            raise RuntimeError("Unsupported session indexes")


async def _has_exact_index(
    connection: aiosqlite.Connection,
    table: str,
    columns: tuple[str, ...],
    *,
    unique: bool,
) -> bool:
    rows = await (await connection.execute(f'PRAGMA index_list("{table}")')).fetchall()
    for row in rows:
        if bool(row["unique"]) is not unique:
            continue
        if await _index_columns(connection, str(row["name"])) == columns:
            return True
    return False


async def _has_positive_nullable_storage_quota(
    connection: aiosqlite.Connection,
) -> bool:
    row = await (
        await connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
        )
    ).fetchone()
    if row is None or row["sql"] is None:
        return False
    normalized = "".join(str(row["sql"]).upper().split())
    return "CHECK(STORAGE_QUOTA_BYTESISNULLORSTORAGE_QUOTA_BYTES>0)" in normalized


async def _has_named_index(
    connection: aiosqlite.Connection,
    table: str,
    name: str,
    columns: tuple[str, ...],
) -> bool:
    rows = await (await connection.execute(f'PRAGMA index_list("{table}")')).fetchall()
    for row in rows:
        if str(row["name"]) != name or bool(row["unique"]):
            continue
        return await _index_columns(connection, name) == columns
    return False


async def _index_columns(
    connection: aiosqlite.Connection,
    name: str,
) -> tuple[str, ...]:
    rows = await (await connection.execute(f'PRAGMA index_info("{name}")')).fetchall()
    return tuple(str(row["name"]) for row in rows)
