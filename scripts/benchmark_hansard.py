"""
Benchmark: Phase 3 online pipeline on the Hansard 2.2 GB CSV.

Usage (from repo root):
    uv run --project backend python scripts/benchmark_hansard.py [--cache-dir PATH]

The old UMAP+HDBSCAN pipeline never completed on this corpus.  This script
measures whether Phase 3 (IncrementalPCA + MiniBatchKMeans) can complete it,
and how long each stage takes.

Pass --cache-dir to warm the embedding cache before timing (optional).
Omit it for a true cold run (embeddings re-computed from scratch).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path

CSV_PATH = Path(
    "/Users/mily/Documents/ldaca/users/user_root/user_data/Local/hansard_processed.csv"
)
TEXT_COLUMN = "text"
MIN_TOPIC_SIZE = 20
RANDOM_SEED = 42
REPRESENTATIVE_WORDS = 5
RESULTS_DIR = Path(__file__).parent


# ---------------------------------------------------------------------------
# Load corpus
# ---------------------------------------------------------------------------

def load_corpus(csv_path: Path, text_column: str) -> list[str]:
    import polars as pl

    print(f"Loading corpus from {csv_path} …", flush=True)
    t0 = time.perf_counter()
    docs: list[str] = (
        pl.scan_csv(csv_path)
        .select(pl.col(text_column).fill_null(""))
        .collect()
        [text_column]
        .to_list()
    )
    elapsed = time.perf_counter() - t0
    total_bytes = sum(len(d) for d in docs)
    print(
        f"  {len(docs):,} docs  |  {total_bytes/1024/1024/1024:.2f} GB text  |  {elapsed:.1f}s to load",
        flush=True,
    )

    # Rough embedding-time estimate
    docs_per_sec = 484          # measured on M1 Max MPS, 26k doc benchmark
    est_embed_s = len(docs) / docs_per_sec
    print(
        f"  Estimated embedding time at {docs_per_sec} docs/s: "
        f"{est_embed_s/60:.0f}–{est_embed_s*1.2/60:.0f} min",
        flush=True,
    )
    return docs


# ---------------------------------------------------------------------------
# Timed progress callback
# ---------------------------------------------------------------------------

class TimedProgress:
    def __init__(self):
        self.events: list[dict] = []
        self._t0 = time.perf_counter()
        self._last = self._t0

    def __call__(self, fraction: float, message: str):
        now = time.perf_counter()
        wall = now - self._t0
        delta = now - self._last
        self._last = now
        entry = {
            "fraction": round(fraction, 3),
            "message": message,
            "wall_s": round(wall, 1),
            "delta_s": round(delta, 1),
        }
        self.events.append(entry)
        tag = f"[{fraction*100:5.1f}%]" if fraction >= 0 else "[ FAIL]"
        print(f"  {tag}  wall={wall/60:5.1f}min  +{delta/60:.1f}min  {message}", flush=True)


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

def run_benchmark(docs: list[str], cache_dir: str | None) -> dict:
    from ldaca_web_app.core.worker_tasks_topic import run_topic_modeling_task

    progress = TimedProgress()
    node_infos = [
        {
            "node_id": "hansard",
            "node_name": "Hansard",
            "text_column": TEXT_COLUMN,
            "original_columns": [TEXT_COLUMN],
        }
    ]

    import inspect
    sig = inspect.signature(run_topic_modeling_task)

    with tempfile.TemporaryDirectory(prefix="tm_bench_hansard_") as tmp:
        wall_start = time.perf_counter()
        kwargs: dict = dict(
            configure_worker_environment=lambda: None,
            user_id="bench-user",
            workspace_id="hansard-benchmark",
            corpora=[docs],
            node_infos=node_infos,
            artifact_dir=tmp,
            artifact_prefix="hansard",
            min_topic_size=MIN_TOPIC_SIZE,
            random_seed=RANDOM_SEED,
            representative_words_count=REPRESENTATIVE_WORDS,
            progress_callback=progress,
        )
        if "embedding_cache_dir" in sig.parameters:
            kwargs["embedding_cache_dir"] = cache_dir
        # force_mode not set → auto (Phase 3 will engage since corpus >> 100k docs)

        result = run_topic_modeling_task(**kwargs)
        wall_total = time.perf_counter() - wall_start

    meta = result.get("meta", {})
    return {
        "wall_total_s": round(wall_total, 1),
        "wall_total_min": round(wall_total / 60, 1),
        "topic_count": len(result.get("topics", [])),
        "doc_count": len(docs),
        "meta": meta,
        "stages": progress.events,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--cache-dir",
        default=None,
        help="Pre-populated embedding cache dir (omit for true cold run)",
    )
    args = parser.parse_args()

    docs = load_corpus(CSV_PATH, TEXT_COLUMN)

    print(f"\n=== Hansard benchmark — {'warm' if args.cache_dir else 'cold'} run ===", flush=True)
    print(f"  Phase 3 threshold: >100k docs OR >250MB text — BOTH exceeded", flush=True)
    print(f"  Online pipeline (IncrementalPCA + MiniBatchKMeans) will auto-engage", flush=True)
    print(flush=True)

    summary = run_benchmark(docs, cache_dir=args.cache_dir)

    print("\n" + "=" * 60, flush=True)
    print(f"Total:        {summary['wall_total_min']:.1f} min", flush=True)
    print(f"Topics found: {summary['topic_count']}", flush=True)
    print(f"Pipeline:     {summary['meta'].get('pipeline_mode', 'unknown')}", flush=True)
    print(f"Backend:      {summary['meta'].get('embedding_backend', 'unknown')}", flush=True)
    if "n_clusters" in summary["meta"]:
        print(f"K (clusters): {summary['meta']['n_clusters']}", flush=True)
    print("=" * 60, flush=True)

    out_file = RESULTS_DIR / "bench_results_hansard.json"
    out_file.write_text(json.dumps(summary, indent=2))
    print(f"\nResults written to {out_file}", flush=True)


if __name__ == "__main__":
    main()
