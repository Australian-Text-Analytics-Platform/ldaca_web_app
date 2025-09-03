import json

import polars as pl
import pytest

from docframe import DocDataFrame, DocLazyFrame  # type: ignore
from docworkspace.node import Node  # type: ignore
from docworkspace.workspace import Workspace  # type: ignore


def build_sample_objects():
    pdf = pl.DataFrame({"a": [1, 2, 3], "text": ["aa", "bb", "cc"]})
    lazy = pdf.lazy()
    doc_df = DocDataFrame(
        pl.DataFrame({"text": ["hello", "world"]}), document_column="text"
    )
    doc_lazy = DocLazyFrame(
        pl.DataFrame({"text": ["lazy", "texts"]}).lazy(), document_column="text"
    )
    return pdf, lazy, doc_df, doc_lazy


def test_workspace_serialize_deserialize_preserves_types(tmp_path):
    pdf, lazy, doc_df, doc_lazy = build_sample_objects()

    ws = Workspace(name="test_ws")
    ws.add_node(Node(data=pdf, name="df"))
    ws.add_node(Node(data=lazy, name="lazy"))
    ws.add_node(Node(data=doc_df, name="docdf"))
    ws.add_node(Node(data=doc_lazy, name="doclazy"))

    out_file = tmp_path / "workspace_save.json"
    ws.serialize(out_file, format="json")

    assert out_file.exists(), "Serialized workspace file not created"

    ws2 = Workspace.deserialize(out_file, format="json")

    # Collect types by node name
    type_map = {n.name: type(n.data).__name__ for n in ws2.nodes.values()}
    assert type_map["df"] == "DataFrame"
    assert type_map["lazy"] == "LazyFrame"
    assert type_map["docdf"] == "DocDataFrame"
    assert type_map["doclazy"] == "DocLazyFrame"

    # Round-trip data content sanity
    df_node = next(n for n in ws2.nodes.values() if n.name == "df")
    assert isinstance(df_node.data, pl.DataFrame)
    assert df_node.data.select(pl.col("a")).to_series().to_list() == [1, 2, 3]

    docdf_node = next(n for n in ws2.nodes.values() if n.name == "docdf")
    assert isinstance(docdf_node.data, DocDataFrame)
    assert docdf_node.data.document_column == "text"
    assert docdf_node.data.to_dataframe().shape == (2, 1)

    doclazy_node = next(n for n in ws2.nodes.values() if n.name == "doclazy")
    assert isinstance(doclazy_node.data, DocLazyFrame)
    collected = doclazy_node.data.collect()
    assert collected.to_dataframe().shape[0] == 2


def test_workspace_binary_not_implemented(tmp_path):
    ws = Workspace(name="bin_ws")
    ws.add_node(Node(data=pl.DataFrame({"x": [1]}), name="df"))

    with pytest.raises(NotImplementedError):
        ws.serialize(tmp_path / "ws.bin", format="binary")

    # Create a dummy json file to attempt binary deserialize and confirm error
    dummy = tmp_path / "ws.json"
    dummy.write_text(
        json.dumps({
            "format": "json",
            "id": "x",
            "name": "n",
            "metadata": {},
            "nodes": {},
            "relationships": [],
        })
    )
    with pytest.raises(NotImplementedError):
        Workspace.deserialize(dummy, format="binary")
