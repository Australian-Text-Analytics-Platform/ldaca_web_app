#!/usr/bin/env python3
"""Debug analysis persistence tests"""

import sys
from pathlib import Path

# Add the source to the path
sys.path.insert(0, str(Path(__file__).parent / "src"))


def test_analysis_creation():
    import tempfile
    from unittest.mock import patch

    from ldaca_web_app_backend.core.analysis_store import save_analysis

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        print(f"Using temp dir: {tmp_path}")

        # Mock the function to return our temp path
        with patch(
            "ldaca_web_app_backend.core.utils.get_user_workspace_folder"
        ) as mock_folder:
            mock_folder.return_value = tmp_path / "test_user" / "user_workspaces"

            # Test save_analysis
            try:
                record = save_analysis(
                    user_id="test_user",
                    workspace_id="test_workspace",
                    task="token_frequencies",
                    request_payload={"test": "data"},
                    result_payload={"success": True},
                )
                print(f"✅ Analysis saved successfully: {record}")

                # Check if file exists
                expected_path = (
                    tmp_path
                    / "test_user"
                    / "user_workspaces"
                    / "test_workspace"
                    / "analysis"
                    / "token_frequencies.json"
                )
                print(f"Expected path: {expected_path}")
                print(f"File exists: {expected_path.exists()}")

                if expected_path.exists():
                    print(f"File contents: {expected_path.read_text()}")
                else:
                    print("File was not created")

            except Exception as e:
                print(f"❌ Error saving analysis: {e}")
                import traceback

                traceback.print_exc()


if __name__ == "__main__":
    test_analysis_creation()
