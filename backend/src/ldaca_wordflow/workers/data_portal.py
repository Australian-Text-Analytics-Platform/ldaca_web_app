"""Process-isolated LDaCA Data Portal import entrypoint.

The worker receives only explicit immutable settings, a transient portal token,
and private import-owned paths. It never imports FastAPI, runtime state, or
global settings, and it writes only inside the staging/cache directories
prepared by the owning service.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from collections.abc import Callable
from multiprocessing.queues import Queue
from pathlib import Path
from typing import Any, cast
from urllib.parse import parse_qs, urlparse

import polars as pl
import httpx

from ..infrastructure.providers.tabular_config import load_tabular_config
from ..infrastructure.providers.oni import OniClient, jsonld_value
from ..shared.portable_names import portable_name_error
from .utils import process_entrypoint


@process_entrypoint
def data_portal_import_process(
    *,
    progress_queue: Queue[Any],
    identifier: str,
    requested_name: str | None,
    api_base_url: str,
    api_token: str | None,
    timeout: float,
    download_concurrency: int,
    staging_dir: str,
    max_output_bytes: int,
) -> dict[str, object]:
    """Tabulate/download one portal object into a private completed directory."""

    report = cast(Callable[[dict[str, object]], None], progress_queue.put)
    staging = Path(staging_dir).resolve(strict=True)
    report({"fraction": 0.05, "message": "Fetching Data Portal metadata"})
    metadata, documents, texts = asyncio.run(
        _fetch_portal_content(
            identifier=identifier,
            api_base_url=api_base_url,
            api_token=api_token,
            timeout=timeout,
            download_concurrency=download_concurrency,
            report=report,
            max_download_bytes=max_output_bytes,
        )
    )
    corpus_name = requested_name or _metadata_name(metadata, identifier)
    folder_name = _safe_name(corpus_name)
    filename = f"{folder_name}.parquet"
    destination = staging / filename

    if documents:
        _write_documents(documents, texts, destination)
    else:
        report({"fraction": 0.25, "message": "Tabulating RO-Crate metadata"})
        _tabulate_metadata(identifier, metadata, destination)

    if destination.stat().st_size > max_output_bytes:
        raise ValueError("Data Portal import exceeds its storage budget")

    readme = staging / "README.md"
    readme.write_text(
        f"# {corpus_name}\n\nSource: {identifier}\n",
        encoding="utf-8",
    )
    total_bytes = destination.stat().st_size + readme.stat().st_size
    if total_bytes > max_output_bytes:
        raise ValueError("Data Portal import exceeds its storage limit")
    report({"fraction": 0.95, "message": "Portal import is ready to publish"})
    return {
        "kind": "data_portal",
        "destination_path": f"LDaCA/{folder_name}",
        "file_count": 2,
        "bytes_written": total_bytes,
    }


async def _fetch_portal_content(
    *,
    identifier: str,
    api_base_url: str,
    api_token: str | None,
    timeout: float,
    download_concurrency: int,
    report: Callable[[dict[str, object]], None],
    max_download_bytes: int,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, str]]:
    """Fetch metadata and document text through one worker-owned HTTP pool."""

    async with httpx.AsyncClient(
        base_url=api_base_url.rstrip("/"),
        timeout=timeout,
        follow_redirects=True,
    ) as http_client:
        client = OniClient(
            http_client,
            token=api_token,
            max_json_bytes=min(max_download_bytes, 8 * 1024 * 1024),
        )
        metadata = await client.get_metadata(identifier)
        documents = _select_text_documents(metadata)
        texts: dict[str, str] = {}
        if documents:
            declared_sizes = [
                int(document["content_size"])
                for document in documents
                if isinstance(document.get("content_size"), int)
            ]
            if sum(declared_sizes) > max_download_bytes:
                raise ValueError("Data Portal documents exceed the import storage budget")
            report({"fraction": 0.25, "message": "Downloading portal documents"})
            texts = await client.download_object_texts(
                identifier,
                [str(document["path"]) for document in documents],
                concurrency=download_concurrency,
                max_total_bytes=max_download_bytes,
                max_document_bytes=min(max_download_bytes, 16 * 1024 * 1024),
            )
        return metadata, documents, texts


def _safe_name(value: str) -> str:
    """Return one deterministic, collision-resistant portable storage name."""

    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]
    normalized = re.sub(r"[^A-Za-z0-9_-]+", "_", value.strip())
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    stem = (normalized or "ldaca_import")[:180]
    candidate = f"{stem}-{digest}"
    if portable_name_error(candidate, exact=True) is not None:
        raise RuntimeError("Portal storage-name sanitizer produced an invalid name")
    return candidate


def _metadata_name(metadata: dict[str, Any], fallback: str) -> str:
    entities = metadata.get("@graph", [])
    root = next(
        (
            entity
            for entity in entities
            if isinstance(entity, dict) and entity.get("@id") in {"./", fallback}
        ),
        None,
    )
    name = jsonld_value(root.get("name")) if isinstance(root, dict) else None
    if name is None:
        name = jsonld_value(metadata.get("name"))
    if isinstance(name, list):
        name = next((item for item in name if item), None)
    return str(name or fallback)


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _first_string(value: Any) -> str | None:
    normalized = jsonld_value(value)
    if isinstance(normalized, list):
        normalized = next((item for item in normalized if item), None)
    return str(normalized) if normalized is not None else None


def _reference_id(value: Any) -> str | None:
    normalized = _first_string(value)
    return normalized if normalized else None


def _content_size(value: Any) -> int | None:
    normalized = _first_string(value)
    if normalized is None:
        return None
    try:
        size = int(normalized)
    except ValueError:
        return None
    return size if size >= 0 else None


def _file_path(file_id: str) -> str | None:
    parsed = urlparse(file_id)
    query_path = parse_qs(parsed.query).get("path")
    if query_path:
        return query_path[0]
    return file_id.removeprefix("./") if not parsed.scheme else None


def _select_text_documents(metadata: dict[str, Any]) -> list[dict[str, Any]]:
    entities = {
        entity.get("@id"): entity
        for entity in metadata.get("@graph", [])
        if isinstance(entity, dict) and entity.get("@id")
    }
    selected: dict[str, dict[str, Any]] = {}
    for entity in entities.values():
        file_id = entity.get("@id")
        if not isinstance(file_id, str):
            continue
        types = {str(item) for item in _as_list(jsonld_value(entity.get("@type")))}
        encodings = {
            str(item).casefold()
            for item in _as_list(jsonld_value(entity.get("encodingFormat")))
        }
        if "File" not in types or "text/plain" not in encodings:
            continue
        path = _file_path(file_id)
        if not path:
            continue
        annotation_of = _reference_id(
            entity.get("ldac:annotationOf") or entity.get("annotationOf")
        )
        work = entities.get(annotation_of) if annotation_of else None
        key = annotation_of or path.removesuffix("-plain.txt").removesuffix(".txt")
        candidate = {
            "file_id": file_id,
            "path": path,
            "name": _first_string(entity.get("name")) or path,
            "encoding_format": "text/plain",
            "content_size": _content_size(entity.get("contentSize")),
            "annotation_of": annotation_of,
            "work_name": _first_string(work.get("name"))
            if isinstance(work, dict)
            else None,
            "date_created": _first_string(work.get("dateCreated"))
            if isinstance(work, dict)
            else None,
        }
        current = selected.get(key)
        if current is None or (
            "-plain." in path and "-plain." not in str(current["path"])
        ):
            selected[key] = candidate
    return sorted(selected.values(), key=lambda item: str(item["path"]))


def _write_documents(
    documents: list[dict[str, Any]],
    texts: dict[str, str],
    destination: Path,
) -> None:
    rows = [
        {**document, "text": texts[str(document["path"])]}
        for document in documents
    ]
    pl.DataFrame(rows).write_parquet(destination)


def _tabulate_metadata(
    identifier: str,
    metadata: dict[str, Any],
    destination: Path,
) -> None:
    """Flatten the configured RO-Crate entity table without an intermediate DB."""

    config = load_tabular_config(identifier)
    tables = config.get("tables", {})
    if not isinstance(tables, dict) or not tables:
        raise ValueError("RO-Crate tabular configuration has no tables")
    table_name = next(
        (
            name
            for name in ("RepositoryObject", "CreativeWork", "File")
            if name in tables
        ),
        next(iter(tables)),
    )
    table_config = tables[table_name]
    if not isinstance(table_config, dict):
        raise ValueError(f"RO-Crate table configuration is invalid: {table_name}")
    entities = _metadata_entities(metadata)
    matching = [
        entity for entity in entities.values() if table_name in _entity_types(entity)
    ]
    if not matching:
        raise ValueError(f"RO-Crate contains no {table_name} metadata")

    ignored = _configured_properties(table_config, "ignore_props")
    expanded = _configured_properties(table_config, "expand_props")
    junctions = _configured_properties(table_config, "junctions")
    junctions.update(_wide_reference_properties(matching))
    rows = [
        _flatten_metadata_entity(
            entity,
            entities,
            ignored=ignored,
            expanded=expanded,
            junctions=junctions,
        )
        for entity in matching
    ]
    pl.DataFrame(rows, strict=False).write_parquet(destination)


def _metadata_entities(metadata: dict[str, Any]) -> dict[str, dict[str, Any]]:
    graph = metadata.get("@graph")
    if not isinstance(graph, list):
        raise ValueError("RO-Crate metadata must contain an @graph array")
    entities: dict[str, dict[str, Any]] = {}
    for raw_entity in graph:
        if not isinstance(raw_entity, dict):
            raise ValueError("RO-Crate @graph entries must be objects")
        entity_id = raw_entity.get("@id")
        if not isinstance(entity_id, str) or not entity_id:
            raise ValueError("RO-Crate entities must have a non-empty @id")
        if entity_id in entities:
            raise ValueError(f"RO-Crate contains a duplicate entity ID: {entity_id}")
        entities[entity_id] = raw_entity
    return entities


def _entity_types(entity: dict[str, Any]) -> set[str]:
    return {
        str(value)
        for value in _as_list(jsonld_value(entity.get("@type")))
        if value is not None
    }


def _configured_properties(config: dict[str, Any], key: str) -> set[str]:
    value = config.get(key, [])
    if not isinstance(value, list):
        raise ValueError(f"RO-Crate table {key} must be an array of strings")
    properties: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            raise ValueError(f"RO-Crate table {key} must be an array of strings")
        properties.add(item)
    return properties


def _wide_reference_properties(entities: list[dict[str, Any]]) -> set[str]:
    """Mirror the source format's junction rule by omitting very wide relations."""

    wide: set[str] = set()
    for entity in entities:
        for name, raw_value in entity.items():
            if name == "@id":
                continue
            references = sum(
                1 for value in _as_list(raw_value) if _reference_container(value)
            )
            if references > 10:
                wide.add(name)
    return wide


def _flatten_metadata_entity(
    entity: dict[str, Any],
    entities: dict[str, dict[str, Any]],
    *,
    ignored: set[str],
    expanded: set[str],
    junctions: set[str],
) -> dict[str, Any]:
    row: dict[str, Any] = {"entity_id": entity["@id"]}
    for name, raw_value in entity.items():
        if name == "@id" or name in junctions:
            continue
        if name in expanded:
            for value in _as_list(raw_value):
                target_id = _reference_container(value)
                target = entities.get(target_id) if target_id is not None else None
                if target is None:
                    continue
                for target_name, target_value in target.items():
                    expanded_name = f"{name}_{target_name}"
                    if target_name == "@id" or expanded_name in ignored:
                        continue
                    _append_metadata_values(
                        row,
                        expanded_name,
                        target_value,
                        entities,
                    )
            continue
        if name not in ignored:
            _append_metadata_values(row, name, raw_value, entities)
    return row


def _append_metadata_values(
    row: dict[str, Any],
    name: str,
    raw_value: Any,
    entities: dict[str, dict[str, Any]],
) -> None:
    for value in _as_list(raw_value):
        target_id = _reference_container(value)
        if target_id is None:
            _set_numbered(row, name, _metadata_scalar(value))
            continue
        target = entities.get(target_id)
        target_name = _first_string(target.get("name")) if target is not None else None
        _set_numbered(row, name, target_name or "")
        _set_numbered(row, f"{name}_id", target_id)


def _reference_container(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    reference = value.get("@id")
    return reference if isinstance(reference, str) and reference else None


def _metadata_scalar(value: Any) -> Any:
    normalized = jsonld_value(value)
    if normalized is None or isinstance(normalized, str | int | float | bool):
        return normalized
    return json.dumps(normalized, ensure_ascii=False, sort_keys=True)


def _set_numbered(row: dict[str, Any], name: str, value: Any) -> None:
    if name not in row:
        row[name] = value
        return
    suffix = 1
    while f"{name}_{suffix}" in row:
        suffix += 1
    if suffix > 10:
        raise ValueError(f"RO-Crate property has too many values: {name}")
    row[f"{name}_{suffix}"] = value


__all__ = ["data_portal_import_process"]
