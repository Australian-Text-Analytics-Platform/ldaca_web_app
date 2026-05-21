# LDaCA Oni API Reference

Supporting details for `SKILL.md`. Verify paths against
`https://data.ldaca.edu.au/api/openapi.json` before relying on an example.

## Configuration Values

Useful configuration values seen live on 2026-05-20:

- Collection profile: `https://w3id.org/ldac/profile#Collection`
- Object profile: `https://w3id.org/ldac/profile#Object`
- Notebook profile: `https://w3id.org/ldac/profile#Notebook`
- Default search fields: `name.@value`, `description.@value`,
  `inLanguage.name.@value`, `_text`, `@id`
- Common facet fields: `@type.keyword`, `encodingFormat.@value.keyword`,
  `license.@id.keyword`, `_root.name.@value.keyword`,
  `_mainCollection.name.@value.keyword`, `_subCollection.name.@value.keyword`

## Structural Discovery With `/object`

Use `GET /api/object` to browse crate summaries. This returns summaries only,
not complete RO-Crate metadata.

Common queries:

```text
GET /api/object?limit=25&offset=0
GET /api/object?memberOf=null&conformsTo=https%3A%2F%2Fw3id.org%2Fldac%2Fprofile%23Collection&limit=25
GET /api/object?memberOf=<encoded-crate-id>&conformsTo=https%3A%2F%2Fw3id.org%2Fldac%2Fprofile%23Object
GET /api/object?id=<encoded-crate-id>
```

Response shape:

```json
{
  "total": 17,
  "data": [
    {
      "crateId": "arcp://name,hdl10.25949~24769173.v1",
      "name": "International Corpus of English (ICE-AUS)",
      "description": "...",
      "license": "https://creativecommons.org/licenses/by/4.0/",
      "recordType": ["Dataset", "RepositoryCollection"],
      "conformsTo": "https://w3id.org/ldac/profile#Collection",
      "url": "https://data.ldaca.edu.au/api/object/arcp%3A%2F%2Fname%2Chdl10.25949~24769173.v1?meta"
    }
  ],
  "nextUrl": "...offset=25"
}
```

Notes:

- Repeating `memberOf` values is supported, including mixed `null` and ids.
- `limit` defaults to 10.
- `offset` and `limit` drive `Content-Range`.
- `GET /api/object?id=...` redirects to `/api/object/{encoded-id}`.

## Searching Documents And Files

Minimal search:

```bash
curl -sS 'https://data.ldaca.edu.au/api/search/index/items' \
  -H 'Content-Type: application/json' \
  --data '{"size": 10, "query": {"match_all": {}}}'
```

Search text-bearing files by MIME type:

```bash
curl -sS 'https://data.ldaca.edu.au/api/search/index/items' \
  -H 'Content-Type: application/json' \
  --data '{
    "size": 25,
    "_source": [
      "@id",
      "@type",
      "_crateId",
      "_memberOf",
      "name",
      "encodingFormat",
      "license"
    ],
    "query": {
      "bool": {
        "must": [
          {"terms": {"@type.keyword": ["File"]}},
          {
            "terms": {
              "encodingFormat.@value.keyword": [
                "text/plain",
                "text/csv",
                "application/pdf"
              ]
            }
          }
        ]
      }
    }
  }'
```

Full-text search across configured fields:

```json
{
  "size": 25,
  "from": 0,
  "_source": [
    "@id",
    "@type",
    "_crateId",
    "name",
    "description",
    "encodingFormat",
    "_memberOf",
    "license"
  ],
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "conversation",
            "fields": ["name.@value", "description.@value", "_text", "@id"]
          }
        }
      ],
      "filter": [{ "terms": { "@type.keyword": ["File"] } }]
    }
  },
  "highlight": {
    "fields": {
      "_text": {}
    }
  }
}
```

Exact field lookup helper:

```text
GET /api/search/fields/items?field=license.@id&value=<url-encoded-value>
```

Search response handling checklist:

- `response.hits.total` may be `{ "value": 10000, "relation": "gte" }` for
  broad searches.
- Use `.keyword` suffixes for exact `terms` filters on text-ish fields.
- A file hit usually has `_source["@id"]`, `_source._crateId`, and
  `_source.encodingFormat`.

## Getting RO-Crate Metadata

Preferred direct metadata path:

```text
GET /api/object/{encodeURIComponent(crateId)}?meta=original
GET /api/object/{encodeURIComponent(crateId)}?meta=all
GET /api/object/{encodeURIComponent(crateId)}?meta=all&raw
```

Compatibility redirect path:

```text
GET /api/object/meta?id=<encoded-crate-id>
GET /api/object/meta?id=<encoded-crate-id>&resolve-parts&noUrid
```

Semantics:

- `meta=original` returns the root RO-Crate metadata only.
- `meta=all` resolves child parts into one combined RO-Crate graph.
- `raw` or `noUrid` returns metadata ids as stored.
- Without `raw` or `noUrid`, Oni rewrites `File` entity ids to API stream URLs.
- `version` is not implemented and returns an error.

## Downloading A Document Or File

Direct object-file route:

```text
GET /api/object/{encodeURIComponent(crateId)}/{filePath}
```

For file paths, percent-encode unsafe characters such as spaces but preserve
slashes. Example verified live:

```bash
curl --range 0-199 \
  'https://data.ldaca.edu.au/api/object/arcp%3A%2F%2Fname%2Chdl10.25949~24769173.v1/ICE%20Spoken/S1A/S1A-001.TXT'
```

Expected file response details:

- `Content-Type` is derived from the filename/MIME mapping.
- `Content-Disposition` names the downloaded file.
- Byte ranges can return `206 Partial Content` through the live nginx path.
- Missing files return 404.

Redirect wrappers:

```text
GET /api/stream?id=<encoded-crate-id>&path=<encoded-logical-path>
GET /api/object/open?id=<encoded-crate-id>&path=<encoded-logical-path>
```

These redirect to `/api/object/{id}/{path}`. Repo docs describe `/stream` as the
bearer-token route and `/object/open` as the browser-session route.
