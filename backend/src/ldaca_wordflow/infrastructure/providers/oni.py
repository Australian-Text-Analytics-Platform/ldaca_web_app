"""Bounded Oni API access for Data Portal reads and imports."""

from __future__ import annotations

import asyncio
import json
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx

from ...models.data_sources import DataPortalSearchMethod
from ...shared.errors import ResourceTooLargeError


DEFAULT_SOURCE_FIELDS = [
    "@id",
    "@type",
    "_crateId",
    "_memberOf",
    "_root",
    "_mainCollection",
    "name",
    "description",
    "encodingFormat",
    "license",
    "conformsTo",
    "_access",
    "error",
]

DEFAULT_SEARCH_FIELDS = ["name.@value", "description.@value", "_text", "@id"]


def extract_ldaca_identifier(value: str) -> str | None:
    """Extract an ARCP identifier from a raw ID or LDaCA portal URL."""
    candidate = value.strip()
    if not candidate:
        return None
    if candidate.startswith("arcp://"):
        return candidate

    parsed = urlparse(candidate)
    query_values = parse_qs(parsed.query)
    for key in ("id", "_crateId"):
        values = query_values.get(key)
        if values and values[0].strip():
            return values[0].strip()
    return None


def jsonld_value(value: Any) -> Any:
    """Normalize common JSON-LD value and ID containers."""
    if isinstance(value, list):
        normalized = [jsonld_value(item) for item in value]
        return normalized[0] if len(normalized) == 1 else normalized
    if isinstance(value, dict):
        if "@value" in value:
            return value["@value"]
        if "@id" in value:
            return value["@id"]
    return value


def _require_page_size(limit: int) -> int:
    if not 1 <= limit <= 100:
        raise ValueError("Data Portal page size must be between 1 and 100")
    return limit


def _require_offset(offset: int) -> int:
    if offset < 0:
        raise ValueError("Data Portal offset cannot be negative")
    return offset


def build_search_body(
    *,
    method: DataPortalSearchMethod,
    query: str,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    """Build the exact OpenSearch request body for one validated search."""
    search_query = query.strip()
    body: dict[str, Any] = {
        "size": _require_page_size(limit),
        "from": _require_offset(offset),
        "_source": DEFAULT_SOURCE_FIELDS,
    }

    if method is DataPortalSearchMethod.IDENTIFIER:
        identifier = extract_ldaca_identifier(search_query) or search_query
        body["query"] = {
            "bool": {
                "should": [
                    {"term": {"@id.keyword": identifier}},
                    {"term": {"_crateId.@value.keyword": identifier}},
                    {"term": {"_crateId.keyword": identifier}},
                ],
                "minimum_should_match": 1,
            }
        }
        return body

    if method is DataPortalSearchMethod.COLLECTION:
        body["query"] = {
            "bool": {
                "filter": [
                    {"terms": {"@type.keyword": ["Dataset", "RepositoryCollection"]}},
                    {"terms": {"_isTopLevel.@value.keyword": ["true"]}},
                ]
            }
        }
        return body

    if method is DataPortalSearchMethod.FILE_FORMAT:
        filters: list[dict[str, Any]] = [{"terms": {"@type.keyword": ["File"]}}]
        if search_query:
            filters.append({"terms": {"encodingFormat.@value.keyword": [search_query]}})
        body["query"] = {"bool": {"filter": filters}}
        return body

    if method is DataPortalSearchMethod.ALL or not search_query:
        body["query"] = {"match_all": {}}
        return body

    body["query"] = {
        "multi_match": {
            "query": search_query,
            "fields": DEFAULT_SEARCH_FIELDS,
        }
    }
    return body


def _string_list(value: Any) -> list[str]:
    """Normalize a JSON-LD value into a list of strings."""

    normalized = jsonld_value(value)
    if normalized is None:
        return []
    if isinstance(normalized, list):
        return [str(item) for item in normalized if item is not None]
    return [str(normalized)]


def _first_string(value: Any) -> str | None:
    """Return the first normalized string, when present."""

    values = _string_list(value)
    return values[0] if values else None


def _unique_strings(*values: Any) -> list[str]:
    """Normalize and de-duplicate strings without changing their order."""

    seen: set[str] = set()
    results: list[str] = []
    for value in values:
        for item in _string_list(value):
            if item not in seen:
                seen.add(item)
                results.append(item)
    return results


def _summary_to_result(summary: dict[str, Any]) -> dict[str, Any]:
    """Normalize one Oni object summary into the public record shape."""

    crate_id = summary.get("crateId") or _first_string(summary.get("_crateId"))
    result_id = summary.get("@id") or crate_id or summary.get("id")
    if not isinstance(result_id, str) or not result_id.strip():
        raise ValueError("Data Portal record is missing its identifier")
    nested_record = summary.get("record")
    if nested_record is not None and not isinstance(nested_record, dict):
        raise ValueError("Data Portal record metadata is invalid")
    record = nested_record or {}
    title = (
        _first_string(summary.get("name"))
        or _first_string(record.get("name"))
        or result_id
    )
    return {
        "id": result_id,
        "crate_id": str(crate_id) if crate_id else None,
        "title": title,
        "description": _first_string(summary.get("description"))
        or _first_string(record.get("description")),
        "types": _string_list(summary.get("recordType") or summary.get("@type")),
        "license": _first_string(summary.get("license")),
        "importable": summary.get("error") != "not_authorized",
        "access": _string_list(summary.get("_access")),
        "collections": _unique_strings(
            summary.get("_memberOf"),
            summary.get("_mainCollection"),
            summary.get("_root"),
            summary.get("_crateId"),
            summary.get("crateId"),
        ),
        "file_formats": _unique_strings(summary.get("encodingFormat")),
    }


def _hit_to_result(hit: dict[str, Any]) -> dict[str, Any]:
    """Normalize one OpenSearch hit into the public record shape."""

    source = hit.get("_source", {})
    if not isinstance(source, dict):
        raise ValueError("Data Portal search hit is invalid")
    return _summary_to_result({"@id": source.get("@id"), **source})


class OniClient:
    """Small async Oni client over a caller-owned HTTP connection pool."""

    def __init__(
        self,
        http_client: httpx.AsyncClient,
        *,
        token: str | None = None,
        max_json_bytes: int = 8 * 1024 * 1024,
    ) -> None:
        """Bind portal operations to a caller-owned pooled HTTP client."""

        self._http_client = http_client
        self.token = token
        self._max_json_bytes = max_json_bytes

    def _headers(self) -> dict[str, str]:
        if not self.token:
            return {}
        return {"Authorization": f"Bearer {self.token}"}

    async def _request_json(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Read one size-bounded JSON object from Oni."""

        content = bytearray()
        async with self._http_client.stream(
            method,
            path,
            params=params,
            json=json_body,
            headers=self._headers(),
        ) as response:
            response.raise_for_status()
            _reject_declared_size(response, self._max_json_bytes)
            async for chunk in response.aiter_bytes():
                if len(content) + len(chunk) > self._max_json_bytes:
                    raise ResourceTooLargeError(
                        "Data Portal JSON response exceeds its configured limit"
                    )
                content.extend(chunk)
        try:
            payload = json.loads(content)
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError("Data Portal returned invalid JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError("Data Portal JSON response must be an object")
        return payload

    async def get_object(self, identifier: str) -> dict[str, Any] | None:
        """Return one object summary, or ``None`` when Oni reports it missing."""

        try:
            data = await self._request_json("GET", "/object", params={"id": identifier})
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return None
            raise
        if data.get("message") == "Not Found":
            return None
        return data

    async def get_metadata(self, identifier: str) -> dict[str, Any]:
        """Return one object's bounded metadata document."""

        return await self._request_json(
            "GET", "/object/meta", params={"id": identifier}
        )

    async def download_object_texts(
        self,
        identifier: str,
        paths: list[str],
        *,
        concurrency: int = 8,
        max_total_bytes: int,
        max_document_bytes: int,
        max_documents: int = 10_000,
    ) -> dict[str, str]:
        """Download a bounded set of text documents with bounded concurrency."""

        if len(paths) > max_documents:
            raise ResourceTooLargeError("Data Portal object has too many documents")
        semaphore = asyncio.Semaphore(concurrency)
        total_lock = asyncio.Lock()
        total_bytes = 0

        async def fetch(path: str) -> tuple[str, str]:
            """Download one bounded-concurrency document through the shared client."""

            nonlocal total_bytes
            async with (
                semaphore,
                self._http_client.stream(
                    "GET",
                    "/object/open",
                    params={"id": identifier, "path": path},
                    headers=self._headers(),
                ) as response,
            ):
                response.raise_for_status()
                _reject_declared_size(response, max_document_bytes)
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(content) + len(chunk) > max_document_bytes:
                        raise ResourceTooLargeError(
                            "Data Portal document exceeds its configured limit"
                        )
                    async with total_lock:
                        if total_bytes + len(chunk) > max_total_bytes:
                            raise ResourceTooLargeError(
                                "Data Portal documents exceed the import storage budget"
                            )
                        total_bytes += len(chunk)
                    content.extend(chunk)
                return path, content.decode(response.encoding or "utf-8")

        pairs = await asyncio.gather(*(fetch(path) for path in paths))
        return dict(pairs)

    async def search(
        self,
        *,
        method: DataPortalSearchMethod,
        query: str,
        limit: int,
        offset: int,
    ) -> tuple[list[dict[str, Any]], int]:
        """Search Oni and normalize one result page."""

        if method is DataPortalSearchMethod.IDENTIFIER:
            identifier = extract_ldaca_identifier(query)
            if identifier:
                summary = await self.get_object(identifier)
                if summary:
                    return [_summary_to_result(summary)], 1

        body = build_search_body(method=method, query=query, limit=limit, offset=offset)
        data = await self._request_json("POST", "/search/index/items", json_body=body)
        hits = data.get("hits", {})
        if not isinstance(hits, dict):
            raise ValueError("Data Portal search response is invalid")
        raw_total = hits.get("total", 0)
        total = raw_total.get("value", 0) if isinstance(raw_total, dict) else raw_total
        raw_items = hits.get("hits", [])
        if not isinstance(raw_items, list) or not all(
            isinstance(item, dict) for item in raw_items
        ):
            raise ValueError("Data Portal search hits are invalid")
        return (
            [_hit_to_result(hit) for hit in raw_items],
            int(total) if isinstance(total, int) and total >= 0 else 0,
        )

    async def featured_collections(
        self, collection_ids: list[str]
    ) -> list[dict[str, Any]]:
        """Resolve the configured featured collection summaries."""

        summaries = await asyncio.gather(
            *(self.get_object(collection_id) for collection_id in collection_ids)
        )
        return [
            _summary_to_result(summary) for summary in summaries if summary is not None
        ]


def _reject_declared_size(response: httpx.Response, limit: int) -> None:
    """Reject an honest oversized Content-Length before reading its stream."""

    raw = response.headers.get("content-length")
    if raw is None:
        return
    try:
        declared = int(raw)
    except ValueError:
        return
    if declared > limit:
        raise ResourceTooLargeError("Data Portal response exceeds its configured limit")
