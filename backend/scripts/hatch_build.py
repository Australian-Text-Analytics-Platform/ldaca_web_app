"""Hatch build hook: extract the frontend archive before packaging."""

from __future__ import annotations

import shutil
import tarfile
from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class FrontendExtractHook(BuildHookInterface):
    """Extract build.tar.gz so the wheel/sdist includes actual frontend files."""

    _FRONTEND_DIR = Path("src/ldaca_wordflow/resources/frontend")
    _ARCHIVE = _FRONTEND_DIR / "build.tar.gz"
    _BUILD_DIR = _FRONTEND_DIR / "build"

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        if not self._ARCHIVE.exists():
            self.app.display_warning(
                f"Frontend archive not found at {self._ARCHIVE} - skipping extraction"
            )
            return

        if self._BUILD_DIR.exists():
            shutil.rmtree(self._BUILD_DIR)

        frontend_root = self._FRONTEND_DIR.resolve()
        with tarfile.open(self._ARCHIVE, "r:gz") as tar:
            # Validate: reject paths that escape the target directory.
            for member in tar.getmembers():
                resolved = (self._FRONTEND_DIR / member.name).resolve()
                if not resolved.is_relative_to(frontend_root):
                    raise RuntimeError(
                        f"Refusing to extract {member.name!r}: path traversal detected"
                    )
            tar.extractall(self._FRONTEND_DIR)

        self.app.display_info(f"Extracted frontend build to {self._BUILD_DIR}")