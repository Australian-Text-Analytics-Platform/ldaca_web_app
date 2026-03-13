import json

import polars as pl
import pytest
from docworkspace.node import Node  # type: ignore
from docworkspace.workspace import Workspace  # type: ignore


def build_sample_objects():
    pdf = pl.DataFrame({"a": [1, 2, 3], "text": ["aa", "bb", "cc"]})
    lazy = pdf.lazy()
    return pdf, lazy


def test_workspace_save_load_preserves_types(tmp_path):
    pdf, lazy = build_sample_objects()

    ws = Workspace(name="test_ws")
    ws.add_node(Node(data=pdf.lazy(), name="df"))
    ws.add_node(Node(data=lazy, name="lazy"))

    out_file = tmp_path / "workspace_save.json"
    ws.save(out_file)

    assert out_file.exists(), "Serialized workspace file not created"

    ws2 = Workspace.load(out_file)

    # Collect types by node name
    type_map = {n.name: type(n.data).__name__ for n in ws2.nodes.values()}
    assert type_map["df"] == "LazyFrame"
    assert type_map["lazy"] == "LazyFrame"

    # Round-trip data content sanity
    df_node = next(n for n in ws2.nodes.values() if n.name == "df")
    assert isinstance(df_node.data, pl.LazyFrame)
    assert df_node.data.select(pl.col("a")).collect().to_series().to_list() == [1, 2, 3]


def test_workspace_save_load_no_format_argument(tmp_path):
    ws = Workspace(name="bin_ws")
    ws.add_node(Node(data=pl.DataFrame({"x": [1]}).lazy(), name="df"))

    # API no longer accepts a format argument.
    with pytest.raises(TypeError):
        ws.save(tmp_path / "ws.bin", format="binary")

    dummy = tmp_path / "ws.json"
    dummy.write_text(
        json.dumps({
            "workspace_metadata": {"id": "x", "name": "n"},
            "nodes": [],
        })
    )
    with pytest.raises(TypeError):
        Workspace.load(dummy, format="binary")
