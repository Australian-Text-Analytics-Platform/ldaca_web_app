# Sample Data Catalogue Plan

Companion to the `sample-data-remote` backend branch. Tracks the design
for evolving the single "Import All" button into a lightweight dataset
browser so users can pick what they need before downloading.

## Context and constraints

- We are **tool developers, not data curators**. Sample data exists only
  so users can try the analytics tools within minutes of first launch.
- The `ldaca-analytics-sample-data` repo will be updated **infrequently**
  — when a new tool needs a specific dataset, or when an existing dataset
  is superseded. It is not a living data archive.
- The catalogue's primary job is to answer: *"which dataset should I load
  to try Tool X?"* — not to describe the data in depth.

---

## What exists today (after `sample-data-remote`)

| Piece | State |
|---|---|
| `ldaca-analytics-sample-data/` sibling repo | ✅ scaffolded, not yet pushed to GitHub |
| `manifest.json` | flat file list with path + size + SHA-256 |
| `settings.sample_data_remote_url` | defaults to GitHub raw URL |
| `download_remote_sample_data(user_id)` | downloads everything; SHA-256 skip if current |
| `POST /files/import-sample-data` | copies bundled → returns; kicks off download as BackgroundTask |

---

## Goal

Replace `manifest.json` with `catalogue.json` and add a simple
dataset-picker panel to the Data Loader page. Users see name, size,
language, and which tool(s) each dataset is good for, then tick what
they want.

---

## `catalogue.json` schema

One file in the root of `ldaca-analytics-sample-data/`. Replaces
`manifest.json` (the download function reads the `files` array inside
each collection).

```json
{
  "schema_version": 1,
  "collections": [
    {
      "id": "ADO/twitter",
      "name": "ADO — Queensland Election Tweets",
      "description": "2020 QLD state election candidate tweets with gender metadata.",
      "language": "en",
      "bundled": true,
      "total_size_bytes": 797062,
      "recommended_for": ["concordance", "token-frequency", "preprocessing"],
      "files": [
        {
          "path": "ADO/twitter/qldelection2020_candidate_tweets.csv",
          "size": 784587,
          "sha256": "ed3d99cb..."
        },
        {
          "path": "ADO/twitter/candidate_info_gender.csv",
          "size": 12475,
          "sha256": "310fffec..."
        }
      ]
    },
    {
      "id": "SCL",
      "name": "SCL — Honi Soit Student Newspaper",
      "description": "University of Sydney student newspaper archive.",
      "language": "en",
      "bundled": true,
      "total_size_bytes": 188074,
      "recommended_for": ["data-loader", "concordance", "topic-modeling"],
      "files": [
        {
          "path": "SCL/Honi_Soit.zip",
          "size": 188074,
          "sha256": "7c119d25..."
        }
      ]
    },
    {
      "id": "ADO/reddit",
      "name": "ADO — Reddit (Australian News)",
      "description": "Reddit submissions and comments from r/australia and related news subreddits.",
      "language": "en",
      "bundled": false,
      "total_size_bytes": 35669159,
      "recommended_for": ["concordance", "sequential-analysis", "topic-modeling"],
      "files": [
        { "path": "ADO/reddit/reddit_comments.parquet",    "size": 20745536, "sha256": "000040cb..." },
        { "path": "ADO/reddit/reddit_submissions.parquet", "size":  2857251, "sha256": "6b00dd43..." },
        { "path": "ADO/reddit/newstalk_comments.parquet",  "size": 12834101, "sha256": "4ea7bead..." },
        { "path": "ADO/reddit/newstalk_stories.parquet",   "size":   232271, "sha256": "6f3fa611..." }
      ]
    }
  ]
}
```

### Fields

| Field | Purpose |
|---|---|
| `id` | Stable identifier; used as the collection key in API requests |
| `bundled` | `true` = shipped with the app installer; no download needed on first import |
| `recommended_for` | Tool IDs (matches the app's internal tool names); drives the "good for…" chips in the UI |
| `total_size_bytes` | Pre-summed for display; avoids the UI having to walk `files` |
| `files[].sha256` | Used by the download function for skip/re-download logic; not displayed |

`language` is a BCP-47 code. When v0.4 adds multilingual datasets, new
collections are added with their own `language` field; existing
collections are untouched.

---

## Backend changes

### 1. Update `download_remote_sample_data`

Change the function to:
- Accept an optional list of collection IDs (`collection_ids: list[str] | None = None`).
  If `None`, download all non-bundled collections (current behaviour).
- Read `catalogue.json` instead of `manifest.json`.
- Walk only the `files` arrays of the selected collections.

Signature change:
```python
async def download_remote_sample_data(
    user_id: str,
    collection_ids: list[str] | None = None,
) -> None:
```

### 2. New endpoint: `GET /files/sample-data/catalogue`

Returns the full catalogue augmented with a per-collection `status` for
the current user.

```python
@router.get("/sample-data/catalogue", response_model=SampleDataCatalogueResponse)
async def get_sample_data_catalogue(current_user: dict = Depends(get_current_user)):
    ...
```

Status values:
| Value | Meaning |
|---|---|
| `bundled` | `bundled: true` in catalogue; always available, no download needed |
| `downloaded` | All files present with correct SHA-256 |
| `partial` | Some files present / some SHA-256 mismatches |
| `not_downloaded` | No files present |

Computing status requires a stat + SHA-256 check per file. With ≤10
collections and ≤5 files each this is fast (< 50 ms). No caching needed
at current scale.

### 3. Update `POST /files/import-sample-data`

Accept an optional body `{ "collection_ids": ["ADO/reddit"] }`.
Default (no body / empty list) = download all non-bundled collections
(backward compatible with the existing frontend button).

```python
class ImportSampleDataRequest(BaseModel):
    collection_ids: list[str] = Field(default_factory=list)
```

---

## Frontend changes

### Data Loader page — "Sample Data" panel

Replace the current single "Import Sample Data" button with a small
expandable panel. Design sketch:

```
┌──────────────────────────────────────────────────────┐
│  Sample Datasets                            [Import ▼]│
├──────────────────────────────────────────────────────┤
│ ☑ ADO — QLD Election Tweets  766 KB  ● Available     │
│   Good for: Concordance · Token Frequency            │
│                                                      │
│ ☑ SCL — Honi Soit            184 KB  ● Available     │
│   Good for: Data Loader · Topic Modeling             │
│                                                      │
│ ☐ ADO — Reddit (Aus News)    34 MB   ○ Not downloaded│
│   Good for: Concordance · Sequential · Topic Model   │
└──────────────────────────────────────────────────────┘
          [Import selected]
```

- Bundled collections default to checked and show `● Available` with no
  download needed.
- Remote collections default to unchecked; show size prominently so the
  user knows what they're opting into.
- "Good for" chips are derived from `recommended_for`; clicking one
  highlights that tool in the Sidebar (nice-to-have, not blocking).
- The panel loads on mount via `GET /files/sample-data/catalogue`.
  On first open it's a single HTTP request + fast file-stat; nothing
  heavy.

---

## Data repo changes

- Rename `manifest.json` → `catalogue.json` (or add `catalogue.json`
  and delete `manifest.json`).
- Populate full SHA-256 values in the `files` arrays (currently
  abbreviated above).

---

## What is explicitly out of scope

- Versioning or changelog for datasets — the repo is a stable snapshot,
  not a living archive.
- Per-file download progress bars — collection-level "downloading…"
  indicator is sufficient.
- User-uploaded dataset registration — the catalogue is read-only from
  the app's perspective.
- Pagination or search — the dataset count is expected to stay < 20.
- Automatic catalogue refresh on a schedule — the download function
  fetches `catalogue.json` fresh on each import request; no daemon
  needed.

---

## Implementation checklist

### Data repo (`ldaca-analytics-sample-data`)
- [ ] Replace `manifest.json` with `catalogue.json` (full SHA-256 values, `recommended_for` populated).

### Backend (`ldaca-wordflow-backend`)
- [ ] `download_remote_sample_data`: accept optional `collection_ids`; read `catalogue.json`.
- [ ] `GET /files/sample-data/catalogue` endpoint + `SampleDataCatalogueResponse` model.
- [ ] `POST /files/import-sample-data`: accept optional `ImportSampleDataRequest` body.

### Frontend (`ldaca-wordflow`)
- [ ] `GET /files/sample-data/catalogue` API call + TypeScript types.
- [ ] Sample Data panel component (collection list + checkbox + status chip + size).
- [ ] Wire "Import selected" button to updated `POST /files/import-sample-data`.
- [ ] Toast: "Bundled datasets ready. Reddit data downloading in background." (when applicable).
