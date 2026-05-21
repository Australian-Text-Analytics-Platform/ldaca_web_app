---
name: ldaca-oni-api
description: Use when integrating with the LDaCA Data Portal Oni API, searching portal records/documents/files, retrieving RO-Crate metadata, or downloading corpus objects from data.ldaca.edu.au.
---

# LDaCA Oni API

## Overview

Use this skill when future work needs the LDaCA Data Portal as an API source.
Oni exposes RO-Crate/OCFL records through a Hono API backed by OpenSearch.

Treat the live API and OpenAPI document as the source of truth. Use examples
from the OpenAPI document only. Use the local reference as a task checklist, not
as a copy-paste source.

Important live endpoints verified on 2026-05-20:

- API base: `https://data.ldaca.edu.au/api`
- OpenAPI JSON: `https://data.ldaca.edu.au/api/openapi.json`
- Swagger alias: `https://data.ldaca.edu.au/api/swagger.json`
- Swagger UI paths `https://data.ldaca.edu.au/docs` and `/api/docs` returned 404
- Live Oni version: `2.1.5`
- Source repo: `https://github.com/Language-Research-Technology/oni`

Detailed request bodies, response shapes, and route examples are in
`.agents/skills/ldaca-oni-api/reference.md`.

## Mental Model

- `object` routes browse crate structure and retrieve RO-Crate/OCFL content.
- `search` routes pass OpenSearch requests through Oni access filtering.
- Search hits are JSON-LD-ish records. Normalize arrays, scalars, `@value`, and
  `@id` forms at the adapter boundary.
- File downloads need both the containing crate id and the logical file path
  inside that crate.

## First Checks

Before implementing against Oni:

1. Fetch `GET /api/configuration` and read `ui.searchFields`,
   `ui.searchHighlights`, `ui.aggregations`, and `ui.conformsTo`.
2. Fetch `GET /api/openapi.json` and confirm the current path list.
3. Read only the section below that matches the current task, then open the
   reference file only when concrete examples are needed.

Use these sections by task:

- Browse collections or objects: `Structural Discovery With /object`.
- Search documents or files: `Searching Documents And Files`.
- Retrieve RO-Crate metadata: `Getting RO-Crate Metadata`.
- Download bytes for a file hit: `Downloading A Document Or File`.
- Implementation wiring: `Implementation Notes`.

## Structural Discovery With `/object`

- Use `GET /api/object` for crate summaries, not complete metadata.
- Use `memberOf=null` for top-level records.
- Use `memberOf=<crate-id>` with `conformsTo` to browse child objects.
- `offset` and `limit` drive pagination and `Content-Range`.
- `GET /api/object?id=...` redirects to `/api/object/{encoded-id}`; clients can
  call the path form directly.

## Searching Documents And Files

- Use `POST /api/search/index/items` with an OpenSearch request body.
- Treat old docs mentioning `/api/search/items` as historical; the live service
  returned 404 for that route.
- Use `GET /api/search/fields/items` for exact field lookups.
- Read hits from `response.hits.hits` and hit data from `_source`.
- Use `from` and `size` for pagination. The live OpenAPI path list does not
  include a scroll route.
- Keep `_source` small; do not fetch `_text` unless the UI needs it.

## Getting RO-Crate Metadata

- Prefer `GET /api/object/{encodeURIComponent(crateId)}?meta=original` for root
  RO-Crate metadata.
- Use `meta=all` only when child parts need to be resolved into one graph.
- Use `raw` or `noUrid` when stored metadata ids must not be rewritten.
- `version` is not implemented and returns an error.
- Combined metadata can be large. Search first, then fetch metadata only for
  selected crates.

## Downloading A Document Or File

Given a search hit:

1. Normalize `crateId` from `_source._crateId`.
2. Normalize `filePath` from `_source["@id"]`.
3. Download with `GET /api/object/{encodeURIComponent(crateId)}/{filePath}`.

For file paths, percent-encode unsafe characters such as spaces but preserve
slashes. The `/api/stream` and `/api/object/open` wrappers redirect to the same
canonical object-file route.

## Auth And Access

- Public searches and metadata can work without auth, but access-filtered
  results may be incomplete.
- Send `Authorization: Bearer <token>` when fetching restricted data or when the
  user is authenticated through the portal.
- Do not hardcode tokens. Use the app's existing secret/session handling.
- A search hit can have limited metadata, `error: "not_authorized"`, or missing
  `_text`. Always check `_source._access.hasAccess` and `_source.error`.

## Implementation Notes

- Build a small Oni client/adapter instead of scattering raw route strings
  across Wordflow.
- Keep search, metadata retrieval, and file download as separate operations.
- Normalize JSON-LD values at the adapter boundary.
- Follow 301 redirects or call canonical path routes directly.
- Preserve access state in the UI. A hit can exist but not be downloadable.
- Use server-side pagination and avoid loading complete crates until selected.

## Source Pointers

In the Oni repo:

- `src/routes/object/index.js`: `/object`, `/object/meta`, `/object/open`, and
  direct object-file routes.
- `src/routes/search/index.js`: `/search/index/{index}` and
  `/search/fields/{index}`.
- `src/controllers/record.js`: RO-Crate metadata transformation and file access.
- `src/services/elastic.js`: access filtering applied to search hits.
- `configuration/default.js`: API base path, profiles, search fields, facets,
  and OpenSearch settings.
