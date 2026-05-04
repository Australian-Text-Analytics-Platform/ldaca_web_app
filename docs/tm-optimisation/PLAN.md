# Topic Modelling Optimisation Plan

**Branch:** `tm-optimisation` (root, `backend/`, `polars-text/`)
**Status:** Planning — no code changes yet
**Started:** 2026-05-04
**Owner:** chao.sun@sydney.edu.au

This is the cross-module plan. Per-module details live in:

- `backend/docs/tm-optimisation/PLAN.md` — embedding backend swap, online pipeline, cache layer, API/job changes
- `polars-text/docs/tm-optimisation/PLAN.md` — Rust content-hash kernel for cache keys (optional, may end up unused)

The top-level work — Tauri sidecar packaging changes, root `pyproject.toml`/`uv.lock` updates, end-to-end test plan, and release coordination — lives here.

---

## Goal

Make BERTopic usable on GB-scale corpora across all deployment targets (Linux cloud, Tauri Mac/Windows, UVX local) without enlarging install size.

Today's behaviour:
- ~20 MB text: acceptable
- Hundreds of MB: slow but completes
- GB-scale: never finishes (verified on M1 Max 64 GB)

Target after this work:
- GB-scale completes in tens of minutes on M1 Max (no GPU torch shipped)
- Install size reduced (drop torch from hot path → save ~150 MB per bundle)
- Same code path runs on Linux/Mac/Windows; platform GPUs used opportunistically via ONNX execution providers

## Hard constraints

- **No CUDA torch** in any local-app bundle (Tauri / UVX). Rejected for size and cross-platform reasons. See [memory: project_deployment_targets.md](../../../../.claude/projects/-Users-mily-Workspace-ATAP-LDaCA-Text-Analytics-Tools-ldaca-web-app/memory/project_deployment_targets.md).
- **CPU must remain a viable execution mode** on all targets. GPU acceleration is opportunistic, never required.
- **No new heavyweight dependencies.** ONNX Runtime (~30 MB) is acceptable; anything torch-sized is not.
- **Don't break existing topic-modelling API.** Frontend should not need to change for phases 1–3. Frontend changes are deferred to phase 4 (progress UI).

## Scope summary

| Module       | Role                                                                                              | Branch needed |
|--------------|---------------------------------------------------------------------------------------------------|---------------|
| root         | Tauri sidecar packaging, `pyproject.toml`, `uv.lock`, frontend changes, e2e test plan, release    | yes           |
| backend      | All ML pipeline changes: embedding backend, cache, online mode, progress reporting                | yes           |
| polars-text  | Optional Rust SHA256 kernel for cache keys (only if Python `hashlib` is a measurable bottleneck)  | yes (provisional) |
| docworkspace | None — workspace/document containers are unaffected                                               | no            |
| ldaca-tabulator | None — UI table component                                                                      | no            |
| frontend (in root) | Progress UI + cancel for phase 4; large-dataset toggle/auto-engage UX                       | done in root branch |

## Phases

Each phase has its own exit criteria. Phases are independently shippable: phase 1 alone is already a major win.

### Phase 1 — ONNX-quantised embeddings (biggest ROI)

**Scope:** Replace `SentenceTransformer("all-MiniLM-L6-v2")` with an ONNX Runtime path using an int8-quantised version of the same model. Provider selection by platform: CoreML on Mac, DirectML on Windows, CPU as universal fallback.

**Wins:** 2–4× speedup on CPU, ~25% model size, drops torch from the embedding hot path, opens GPU access on Mac/Windows without bundling CUDA.

**Files (backend):**
- `backend/src/ldaca_web_app/core/worker_tasks_topic.py:21-31` — `_get_embedder` swap
- `backend/src/ldaca_web_app/core/worker_tasks_topic.py:34-55` — `_encode_embeddings_in_chunks` adapt
- `backend/src/ldaca_web_app/core/model_prefetch.py` — prefetch ONNX model files instead of HF safetensors
- `backend/pyproject.toml` — add `onnxruntime`, `optimum[onnxruntime]`, `tokenizers`; investigate whether `sentence-transformers`/`torch` can be dropped or made optional

**Files (root):**
- `pyproject.toml`, `uv.lock` — propagate dep changes
- `scripts/package_backend_runtime.py` — verify the relocatable runtime still works after the dep swap (ONNX Runtime ships native .so/.dylib/.dll files; need to confirm relocation)
- `frontend/src-tauri/tauri.conf.json` resources — recheck bundle size

**Exit criteria:**
- Topic modelling on a 50k-doc corpus produces results equivalent to the torch path (topic count ±10%, top words largely overlapping)
- CPU latency on the same corpus reduced by ≥2× (measure on M1 Max + a Linux box)
- `du -sh dist-tauri/backend-runtime` reduced by ≥100 MB
- `bertopic` still works in tests (UMAP+HDBSCAN unchanged)

**Status:** complete — backend commit `f5e0b2c`; CoreML fix commit `30fbf07`

Benchmark results (26,163-doc corpus, M1 Max, 2026-05-04):

| Run | Embedding | UMAP+HDBSCAN | Total | vs OLD |
|-----|-----------|--------------|-------|--------|
| OLD cold (SentenceTransformer + PyTorch MPS) | ~64s* | ~30s* | **101.6s** | baseline |
| NEW cold (ONNX ARM64 CPU) | 200.7s | 41.6s | **251.1s** | 2.5× **slower** |
| NEW warm (Phase 2 cache hit) | 0.6s | 29.5s | **30.1s** | **3.4× faster** |

*\*Old code has a single progress callback covering embedding+pipeline together; split estimated from new warm UMAP time.*

**Key finding:** CoreML (`CoreMLExecutionProvider`) had 285/418 graph nodes on CoreML across 55 partitions, producing ~45k cross-device sync ops per run — resulting in 1295s (21 min) for embedding. **Fix: drop CoreML, use ARM64 quantized CPU ONNX.** This reduced embedding from 1295s → 201s.

**Remaining gap:** ONNX ARM64 CPU (201s) is still slower than SentenceTransformer with PyTorch MPS (~64s). PyTorch MPS maps the full BERT graph to Apple Silicon GPU/Neural Engine as a single unit with no partitioning overhead. The ONNX approach trades cold-run speed for bundle size (-~150 MB) and cross-platform compatibility. The **warm run (Phase 2 cache) fully offsets this gap** for iterative use: 30s vs 102s cold.

**Recommendation for Phase 5:** Implement the MPS path (see Phase 5) to recover cold-run performance on Mac. On Windows, DirectML covers the full ONNX graph and should be competitive or faster than the old CPU torch baseline.

---

### Phase 2 — Embedding disk cache

**Scope:** Cache embeddings to disk keyed by `sha256(text) + model_id + provider_id`. On rerun, load cached embeddings instead of recomputing. UMAP and clustering parameters can be tweaked freely without paying the embedding cost again.

**Storage:** Parquet under the user data dir, one file per `(workspace_id, model_id)`, columns: `hash` (binary 32B), `embedding` (FixedSizeList[float16, 384]). Use float16 to halve disk footprint with negligible quality impact.

**Files (backend):**
- New: `backend/src/ldaca_web_app/core/embedding_cache.py` — read/write logic, content-hash batching
- Modify: `worker_tasks_topic.py` — query cache before encoding, write back after

**polars-text role (optional, decide in phase 2):**
- Hashing many strings in Python via `hashlib.sha256` is fast enough for hundreds of thousands of docs (~1 µs/doc). Only consider a Rust kernel in `polars-text` if profiling shows hashing >5% of pipeline time at GB scale.
- Decision deferred to a profiling step early in phase 2.

**Exit criteria:**
- Re-running topic modelling on the same corpus with same model takes <5% of the cold-run time (i.e., embedding cost is essentially eliminated)
- Cache survives backend restart
- Cache can be cleared via API (and via a UI button — frontend phase)
- Cache is per-user, never shared across users

**Status:** complete — backend commit `9239c39`

Notes from implementation:
- Stored as float16 (≈1e-2 atol round-trip error; well within cosine-sim tolerance)
- `embedding_cache_dir` defaults to `None` (bypasses cache) so tests that don't set it still pass
- Cache is per-(model_id, provider_id) file; different providers can't share (float differences break UMAP reproducibility)
- LRU eviction deferred — warns at 500 MB, refuses writes above 2 GB

---

### Phase 3 — Online pipeline for large datasets

**Scope:** When the corpus exceeds a threshold (initial: 100k docs OR ≥250 MB raw text), automatically swap BERTopic's UMAP+HDBSCAN combo for the online configuration: `IncrementalPCA` + `MiniBatchKMeans` + `OnlineCountVectorizer`. This is what BERTopic explicitly supports for the streaming/large-data regime.

**Tradeoff:** Loses density-based outlier "topic -1". For a result that completes vs. one that doesn't, this is the right tradeoff. Document it in the UI.

**Alternative considered:** "Sample-and-extend" — fit on a stratified 100k sample, then `transform()` the rest. Lighter touch but produces a worse topic structure on truly diverse corpora. Keep this as a fallback if online mode has quality issues.

**Files (backend):**
- `worker_tasks_topic.py` — `_compute_topics` branches on doc count / total size
- New helper: build online pipeline (a few lines using BERTopic's `online_topic_modeling` doc as reference)
- API: pass-through any user-set knobs (cluster count for KMeans)

**Exit criteria:**
- 1 GB synthetic corpus (e.g., concatenated dev docs) produces a topic model on M1 Max in <30 minutes
- Threshold can be overridden by user (force-online, force-classic)
- Result schema is identical so the frontend doesn't notice

**Status:** complete

Notes from implementation:
- `_should_use_online_pipeline()` auto-selects by `_ONLINE_THRESHOLD_DOCS` (100k) or `_ONLINE_THRESHOLD_BYTES` (250 MB); `force_mode="online"/"classic"` overrides both thresholds
- `_build_online_pipeline()` uses `IncrementalPCA(n_components=5)` + `MiniBatchKMeans(n_clusters=k, n_init="auto")` + `OnlineCountVectorizer` (fallback to default if unavailable)
- `k` defaults to `max(10, min(200, sqrt(n_docs/2)))` when `n_clusters` not provided
- `meta.pipeline_mode` ("online"/"classic") and `meta.n_clusters` (online only) added to all result payloads
- `force_mode` and `n_clusters` threaded through `TopicModelingRequest` (models + analysis), API route, `worker.py`, and `run_topic_modeling_task`
- `OnlineCountVectorizer` import is guarded; missing import falls back to BERTopic default vectorizer
- Outlier topic -1 is absent in online mode (expected; documented in plan tradeoff)

---

### Phase 4 — Honest progress + cancellability

**Scope:** Per-stage progress reporting (embedded N/M docs, dim-reduction step x/y, clustering done) and a real cancel signal. Today, long jobs feel "stuck" and users SIGKILL them.

**Files (backend):**
- `worker_tasks_topic.py` — emit progress to a side channel (already has task-status endpoints)
- `core/worker.py` — wire cancellation into the `ProcessPoolExecutor` task

**Files (frontend):**
- `frontend/src/features/analysis/topic-modeling/hooks/useTopicModelingTaskFlow.ts` — display per-stage progress
- `frontend/src/features/analysis/topic-modeling/TopicModelingResultsPanel.tsx` — cancel button + state

**Exit criteria:**
- Each pipeline stage emits at least one progress event per 10s of wall time during long runs
- Cancel kills the worker process within 5 s

**Status:** partially complete — backend commit `f315b11`; frontend commit pending

What's done:
- `worker.py`: `_pid_reporting_wrapper` is a top-level wrapper executed inside the worker process; it sends `{"type": "pid", "pid": os.getpid()}` through the progress queue before delegating to the real task function, making the PID available on the main-process side
- `worker_task_manager.py`: `TaskInfo.worker_pid` field; `_consume_worker_progress` captures the PID from the queue; new `stop_task()` method sets status to `CANCELLED`, sends `SIGTERM` to the worker PID, calls `future.cancel()` as belt-and-braces for queued tasks, emits SSE update — **task record is kept** (not removed) for user dismissal; `_monitor_task_completion` no longer overrides `CANCELLED` status with a failure on `BrokenProcessPool`
- `api/tasks.py`: new `POST /tasks/cancel?task_id=...` endpoint calls `stop_task()`
- `frontend/src/api/workspaces.ts`: `cancelTask()` pointing to `/tasks/cancel`
- `frontend/src/components/layout/Sidebar.tsx`: Stop button calls `cancelTask` (no local state removal — SSE pushes the cancelled state update); Clear button on terminal states works as before

What's **not** done yet (remaining exit criterion):
- Per-chunk progress callbacks during embedding (`_encode_embeddings_in_chunks` inner loop is silent for ~3 min currently). The progress bar shows 0% for the entire embedding phase.

---

### Phase 5 — Apple Silicon MPS for cold-run performance

**Scope:** On Apple Silicon, use `SentenceTransformer` with `device="mps"` (PyTorch MPS backend) instead of ONNX Runtime for the embedding step. MPS maps the full BERT graph to Apple Silicon GPU/Neural Engine without partitioning.

**Benchmark results (26,163-doc corpus, M1 Max, 2026-05-04 — measured on Phase 5 code):**

| Run | Embedding | UMAP+HDBSCAN | Total | vs OLD |
|-----|-----------|--------------|-------|--------|
| OLD cold (SentenceTransformer + MPS, pre-Phase-1) | ~64s* | ~30s* | **101.6s** | baseline |
| Phase 1–3 cold (ONNX ARM64 CPU) | 200.7s | 41.6s | **251.1s** | 2.5× slower |
| Phase 5 cold (MPS) | **54s** | 40s | **107.3s** | essentially same as old |
| Phase 5 warm (cache hit) | 0.7s | 29s | **29.5s** | 3.4× faster than old cold |

*\*Old code had a single progress callback; split estimated from warm UMAP time.*

MPS embedding is **54s** — 3.7× faster than ONNX ARM64 CPU (201s) and better than the estimated 64s. Total cold run 107s is within ~5% of the pre-Phase-1 baseline. The Phase 2 cache makes cold runs rare in practice; warm runs remain 29s.

**Constraint:** `torch` and `sentence-transformers` are already transitive deps via `bertopic` — no new packages added; bundle size unchanged.

**Files (backend):**
- New `mps_embedder.py` — `is_mps_available()`, `get_active_provider_id()`, `MpsEmbedder`
- `worker_tasks_topic.py` — `_get_embedder` prefers MPS when available; `embedding_backend` meta field reflects actual path (`"mps"` or `"onnx"`)
- `model_prefetch.py` — dispatches to MPS or ONNX prefetch based on platform
- `topic_modeling.py` cache-clear endpoint — uses `get_active_provider_id()`

**Exit criteria:**
- ✅ Cold embedding on 26k-doc corpus on M1 Mac ≤ 90s — actual: 54s
- ✅ Windows path unchanged (ONNX + DirectML still used)
- ✅ Linux path unchanged (ONNX + CPU quantized)
- ✅ Bundle size increase ≤ 50 MB — no new packages

**Status:** complete

---

## Decisions log

| Date       | Decision                                                                                       | Rationale |
|------------|------------------------------------------------------------------------------------------------|-----------|
| 2026-05-04 | Branch off `dev` (root + backend) and `main` (polars-text) for `tm-optimisation`               | Aligns with current integration state |
| 2026-05-04 | Skip `docworkspace` and `ldaca-tabulator`                                                      | No ML or topic-modelling code lives there |
| 2026-05-04 | `polars-text` branch is provisional — may end up unused if Python hashing is fast enough       | Avoid a Rust dependency unless profiling justifies it |
| 2026-05-04 | Phase 1 (ONNX) ships first as standalone improvement                                           | Independently valuable, biggest size + speed win |
| 2026-05-04 | Online pipeline auto-engages by threshold; user can override                                   | Most users don't know to choose; threshold gives a sensible default |
| 2026-05-04 | No `model_quantized.onnx` in the HF repo — use arch-specific variants instead                 | Actual repo has arm64/avx2 quantized + fp32; discovered via `list_repo_files` |
| 2026-05-04 | CoreML/DirectML providers use fp32 model; CPU provider uses quantized                         | Hardware-accelerated providers apply their own compilation on fp32; pre-quantized models can cause op compatibility issues |
| 2026-05-04 | **Drop `CoreMLExecutionProvider` from provider selection on Mac**                              | all-MiniLM-L6-v2 ONNX graph has only 68% CoreML node coverage (285/418), producing 55 partitions with ~45k CoreML↔CPU syncs per run. Embedding 26k docs took 21 min with CoreML vs 3.3 min with ARM64 CPU ONNX. `model_qint8_arm64.onnx` on `CPUExecutionProvider` is dramatically faster. DirectML on Windows covers the full graph and remains preferred. |
| 2026-05-04 | **Phase 5: use `SentenceTransformer(device="mps")` on Apple Silicon, not ONNX CoreML**        | MPS maps the full BERT graph to Metal/Neural Engine as a single unit — no partition overhead. Measured 54s cold embedding vs 201s ONNX ARM64 CPU (3.7×). torch/sentence-transformers already a transitive dep via bertopic; no new heavyweight dependency. ONNX path retained for Windows (DirectML) and Linux (CPU quantized). |

## Open questions

1. ~~**ONNX model source.**~~ Resolved: use upstream `sentence-transformers/all-MiniLM-L6-v2` `onnx/` files directly. The repo has `model_qint8_arm64.onnx`, `model_quint8_avx2.onnx`, and `model.onnx` (fp32). Platform-aware selection in `_select_onnx_filename()`.
2. ~~**Tokenizer.**~~ Resolved: HuggingFace `tokenizers` library (Rust-backed), loaded from `tokenizer.json` in the same repo.
3. **Can we drop `sentence-transformers` entirely?** The library is mostly a torch wrapper around HF transformers. If we go pure ONNX + tokenizers + numpy, we save another ~10 MB and a bunch of transitive deps. Worth investigating in phase 1.
4. **CoreML provider behaviour on Intel Macs.** We dropped Intel Mac builds (verify), but if not, CoreML on Intel may fall back unhelpfully — test path needed.
5. **DirectML provider on older Windows.** Min Windows version supported by DirectML EP — confirm it matches our Tauri build target.
6. **Cache invalidation on model upgrade.** Decide: prune-on-startup vs. keep-with-version-suffix vs. user-clears.
7. **Per-user cache location.** Reuse the existing user-data dir from the workspace store, or a new path?

## How to resume from another session

1. **Read this file and the per-module plans first.**
2. Check `git -C <repo> log --oneline tm-optimisation ^dev` (or `^main` for polars-text) to see what's already been done.
3. Look at the **Status** lines under each phase — phases are linear; pick the first one not done.
4. Each phase's "Files" subsection lists exact paths and line numbers to start at.
5. Append to the **Decisions log** when making non-obvious choices.
6. Update **Status** when a phase passes its exit criteria.

## Verification

End-to-end testing happens at the root level. Before calling any phase done:

- [ ] Run existing topic-modelling tests in `backend/tests/`
- [ ] Run a smoke test: small corpus through the full UI on Tauri (Mac at minimum)
- [ ] `du -sh dist-tauri/backend-runtime` — record before/after
- [ ] Check that `scripts/package_backend_runtime.py` still produces a relocatable runtime (the script's own self-test must pass)
- [ ] Smoke test the UVX install path: `uvx ldaca-web-app` end-to-end on a clean machine or fresh venv

## Out of scope

These are tempting but not part of this plan:

- Replacing UMAP with cuML UMAP (GPU-only, breaks constraints)
- Server-side GPU service the local apps call into (adds infra dependency for local-only users)
- A different topic modelling algorithm (LDA, Top2Vec) — keep BERTopic, this is a perf project not a redesign
- Model selection UI (different sentence-transformer models) — interesting but separate
