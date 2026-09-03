"""Verify the backend wheel's public package and bundled-resource contract."""

from __future__ import annotations

import pathlib
import sys
import zipfile


def verify_distribution(dist_dir: pathlib.Path) -> None:
    wheels = list(dist_dir.glob("*.whl"))
    if len(wheels) != 1:
        raise RuntimeError(f"expected exactly one wheel in {dist_dir}, found {len(wheels)}")

    with zipfile.ZipFile(wheels[0]) as archive:
        names = archive.namelist()
        required = (
            "ldaca_wordflow/domain/workspace/analysis.py",
            "ldaca_wordflow/infrastructure/storage/workspace_store.py",
            "ldaca_wordflow/_vendor/gender_gap_tracker/quote_extractor.py",
            "ldaca_wordflow/_vendor/gender_gap_tracker/LICENSE",
            "ldaca_wordflow/resources/frontend/build/index.html",
        )
        for suffix in required:
            if not any(name.endswith(suffix) for name in names):
                raise RuntimeError(f"wheel is missing {suffix}")

        if any(
            "docworkspace" in name.casefold() or "rocrate_tabular" in name
            for name in names
        ):
            raise RuntimeError("wheel contains a removed package surface")

        metadata_name = next(
            name for name in names if name.endswith(".dist-info/METADATA")
        )
        metadata = archive.read(metadata_name).decode("utf-8")
        if "Requires-Dist: en-core-web-md" in metadata:
            raise RuntimeError("wheel metadata must not require en-core-web-md")
        for removed in (
            "docworkspace",
            "fastar",
            "pyarrow",
            "rocrate-tabular",
            "tomli-w",
            "xlsxwriter",
        ):
            if f"Requires-Dist: {removed}" in metadata:
                raise RuntimeError(f"wheel metadata retains removed dependency {removed}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify_backend_distribution.py <dist-directory>")
    verify_distribution(pathlib.Path(sys.argv[1]))
