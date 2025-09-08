#!/usr/bin/env python3
"""Test specific failing tests to verify fixes"""

import subprocess
import sys


def run_test(test_path, timeout=30):
    """Run a specific test with timeout"""
    try:
        result = subprocess.run(
            ["uv", "run", "pytest", test_path, "-v", "--tb=short"],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd="/Users/sguo0589/Sources/LDaCA-Text-Analytics-Tools/ldaca_web_app/backend",
        )

        print(f"Test: {test_path}")
        print(f"Exit code: {result.returncode}")
        if result.returncode == 0:
            print("✅ PASSED")
        else:
            print("❌ FAILED")
            print("STDOUT:", result.stdout[-500:])  # Last 500 chars
            print("STDERR:", result.stderr[-500:])  # Last 500 chars
        print("-" * 80)

        return result.returncode == 0

    except subprocess.TimeoutExpired:
        print(f"⏰ TIMEOUT: {test_path}")
        return False
    except Exception as e:
        print(f"❌ ERROR running {test_path}: {e}")
        return False


def main():
    tests_to_check = [
        # Test our fixture fix
        "tests/integration/test_analysis_persistence.py::TestTokenFrequencyPersistence::test_token_frequency_creates_analysis_record",
        # Test unit tests
        "tests/unit/persistence/test_analysis_store.py::TestSaveAnalysis::test_save_analysis_creates_file",
        # Test comprehensive analysis
        "tests/integration/test_comprehensive_analysis.py::TestParametrizedAnalysisPersistence::test_analysis_persistence_generic",
    ]

    print("Testing specific fixes...")
    print("=" * 80)

    results = []
    for test in tests_to_check:
        results.append(run_test(test))

    print("\nSummary:")
    print(f"Passed: {sum(results)}/{len(results)}")

    if all(results):
        print("🎉 All tests passed!")
        return 0
    else:
        print("❌ Some tests failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
