#!/usr/bin/env python3
"""Run specific tests with timeout, for local debugging.

Usage:
  python scripts/debug_test.py [--timeout 30] tests/path::TestClass::test_name ...

If no tests are provided, a small default set will be run.
"""
import argparse
import subprocess
import sys
from typing import List


def run_test(test_path: str, timeout: int = 30) -> bool:
    try:
        result = subprocess.run(
            ["uv", "run", "pytest", test_path, "-v", "--tb=short"],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        print(f"Test: {test_path}")
        print(f"Exit code: {result.returncode}")
        if result.returncode == 0:
            print("✅ PASSED")
        else:
            print("❌ FAILED")
            print("STDOUT:")
            print(result.stdout[-500:])
            print("STDERR:")
            print(result.stderr[-500:])
        print("-" * 80)
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        print(f"⏰ TIMEOUT: {test_path}")
        return False
    except Exception as e:  # noqa: BLE001
        print(f"❌ ERROR running {test_path}: {e}")
        return False


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("tests", nargs="*", help="Tests to run (file[::Class[::test]])")
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args(argv)

    if not args.tests:
        to_run = [
            "tests/integration/test_analysis_persistence.py::TestTokenFrequencyPersistence::test_token_frequency_creates_analysis_record",
            "tests/unit/persistence/test_analysis_store.py::TestSerializationPersistence::test_analyses_survive_workspace_reload",
            "tests/integration/test_comprehensive_analysis.py::TestParametrizedAnalysisPersistence::test_analysis_persistence_generic",
        ]
    else:
        to_run = args.tests

    results = [run_test(t, timeout=args.timeout) for t in to_run]
    print("\nSummary:")
    print(f"Passed: {sum(results)}/{len(results)}")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

