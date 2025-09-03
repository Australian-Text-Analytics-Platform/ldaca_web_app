"""Test workspace.py shim imports correctly."""


def test_workspace_shim_import():
    """Test that the workspace.py shim allows backward-compatible imports."""
    from docworkspace.workspace import Workspace
    from docworkspace.workspace.core import Workspace as CoreWorkspace

    # Should be the same class
    assert Workspace is CoreWorkspace

    # Should be able to instantiate via shim
    ws = Workspace("test_workspace")
    assert ws.name == "test_workspace"
