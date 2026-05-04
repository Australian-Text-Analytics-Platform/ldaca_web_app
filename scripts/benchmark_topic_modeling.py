"""
Benchmark script: compare tm-optimisation branch vs pre-Phase-1 baseline.

Usage (run from repo root with uv):
    uv run --project backend python scripts/benchmark_topic_modeling.py <new|old>

Pass "new" to benchmark the current (tm-optimisation) implementation.
Pass "old" to benchmark the baseline (eda7dcc, pre-Phase-1) implementation.
The script prints a per-stage timing table and overall wall time.

After both runs, compare the two JSON result files:
    scripts/bench_results_new.json
    scripts/bench_results_old.json
"""

from __future__ import annotations

import json
import sys
import tempfile
import time
import zipfile
from pathlib import Path

CORPUS_ZIP = Path(
    "/Users/mily/Documents/ldaca/users/user_root/user_data/Local/corpus_articleid.zip"
)
MIN_TOPIC_SIZE = 20
RANDOM_SEED = 42
REPRESENTATIVE_WORDS = 5
RESULTS_DIR = Path(__file__).parent  # scripts/

# ---------------------------------------------------------------------------
# Load corpus
# ---------------------------------------------------------------------------

def load_corpus(zip_path: Path) -> list[str]:
    print(f"Loading corpus from {zip_path} …", flush=True)
    t0 = time.perf_counter()
    docs: list[str] = []
    with zipfile.ZipFile(zip_path) as zf:
        for name in zf.namelist():
            if name.endswith(".txt"):
                with zf.open(name) as fh:
                    docs.append(fh.read().decode("utf-8", errors="replace").strip())
    elapsed = time.perf_counter() - t0
    total_bytes = sum(len(d) for d in docs)
    print(
        f"  Loaded {len(docs):,} docs  |  {total_bytes/1024/1024:.1f} MB  |  {elapsed:.2f}s",
        flush=True,
    )
    return docs


# ---------------------------------------------------------------------------
# Progress callback that also records per-stage timings
# ---------------------------------------------------------------------------

class TimedProgress:
    def __init__(self, label: str):
        self.label = label
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
            "wall_s": round(wall, 2),
            "delta_s": round(delta, 2),
        }
        self.events.append(entry)
        tag = f"[{fraction*100:5.1f}%]" if fraction >= 0 else "[ FAIL]"
        print(f"  {tag}  +{delta:6.2f}s  {message}", flush=True)


# ---------------------------------------------------------------------------
# Run benchmark against the currently-importable worker module
# ---------------------------------------------------------------------------

def run_benchmark(docs: list[str], label: str, cache_dir: str | None) -> dict:
    from ldaca_web_app.core.worker_tasks_topic import run_topic_modeling_task  # type: ignore[import]

    progress = TimedProgress(label)

    node_infos = [
        {
            "node_id": "bench-node",
            "node_name": "Benchmark corpus",
            "text_column": "text",
            "original_columns": ["text"],
        }
    ]

    with tempfile.TemporaryDirectory(prefix="tm_bench_") as tmp:
        wall_start = time.perf_counter()

        kwargs: dict = dict(
            configure_worker_environment=lambda: None,
            user_id="bench-user",
            workspace_id="bench-workspace",
            corpora=[docs],
            node_infos=node_infos,
            artifact_dir=tmp,
            artifact_prefix="bench",
            min_topic_size=MIN_TOPIC_SIZE,
            random_seed=RANDOM_SEED,
            representative_words_count=REPRESENTATIVE_WORDS,
            progress_callback=progress,
        )
        # New implementation accepts force_mode/n_clusters/embedding_cache_dir;
        # old does not.  Inspect signature to decide whether to pass them.
        import inspect
        sig = inspect.signature(run_topic_modeling_task)
        if "embedding_cache_dir" in sig.parameters:
            kwargs["embedding_cache_dir"] = cache_dir
        if "force_mode" in sig.parameters:
            kwargs["force_mode"] = "classic"  # force classic for apples-to-apples

        result = run_topic_modeling_task(**kwargs)

        wall_total = time.perf_counter() - wall_start

    topic_count = len(result.get("topics", []))
    meta = result.get("meta", {})

    return {
        "label": label,
        "wall_total_s": round(wall_total, 2),
        "topic_count": topic_count,
        "doc_count": len(docs),
        "meta": meta,
        "stages": progress.events,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("new", "old"):
        print("Usage: uv run python scripts/benchmark_topic_modeling.py <new|old>")
        sys.exit(1)

    variant = sys.argv[1]
    out_file = RESULTS_DIR / f"bench_results_{variant}.json"

    docs = load_corpus(CORPUS_ZIP)

    # For the new implementation, run twice: cold (no cache) and warm (with cache).
    # For old, just one cold run.
    if variant == "new":
        with tempfile.TemporaryDirectory(prefix="tm_bench_cache_") as cache_dir:
            print("\n=== NEW — cold run (no cached embeddings) ===", flush=True)
            cold = run_benchmark(docs, "new_cold", cache_dir=None)

            print(f"\n=== NEW — warm run (embeddings pre-cached in {cache_dir}) ===", flush=True)
            # First we need a cache-warmed state — re-run with the cache dir
            # pre-populated by the cold run (use separate cache dir to isolate).
            with tempfile.TemporaryDirectory(prefix="tm_bench_cache2_") as cache_dir2:
                print("  Pre-warming cache …", flush=True)
                _warm = run_benchmark(docs, "new_warm_prewarm", cache_dir=cache_dir2)
                print("\n  Running warm benchmark …", flush=True)
                warm = run_benchmark(docs, "new_warm", cache_dir=cache_dir2)

        summary = {"cold": cold, "warm": warm}
        print("\n" + "="*60)
        print(f"NEW cold  total: {cold['wall_total_s']:.1f}s  |  {cold['topic_count']} topics")
        print(f"NEW warm  total: {warm['wall_total_s']:.1f}s  |  {warm['topic_count']} topics")
    else:
        print("\n=== OLD — cold run ===", flush=True)
        cold = run_benchmark(docs, "old_cold", cache_dir=None)
        summary = {"cold": cold}
        print("\n" + "="*60)
        print(f"OLD cold  total: {cold['wall_total_s']:.1f}s  |  {cold['topic_count']} topics")

    out_file.write_text(json.dumps(summary, indent=2))
    print(f"\nResults written to {out_file}")

    # If both result files exist, print comparison
    new_f = RESULTS_DIR / "bench_results_new.json"
    old_f = RESULTS_DIR / "bench_results_old.json"
    if new_f.exists() and old_f.exists():
        new_data = json.loads(new_f.read_text())
        old_data = json.loads(old_f.read_text())
        old_cold_s = old_data["cold"]["wall_total_s"]
        new_cold_s = new_data["cold"]["wall_total_s"]
        new_warm_s = new_data["warm"]["wall_total_s"]
        print("\n" + "="*60)
        print("COMPARISON SUMMARY")
        print("="*60)
        print(f"  Old cold run:      {old_cold_s:.1f}s")
        print(f"  New cold run:      {new_cold_s:.1f}s  ({old_cold_s/new_cold_s:.1f}x faster)")
        print(f"  New warm run:      {new_warm_s:.1f}s  ({old_cold_s/new_warm_s:.1f}x faster than old cold)")
        print("="*60)


if __name__ == "__main__":
    main()
