import sys
from types import ModuleType

import numpy as np
import pandas as pd
import polars as pl
from ldaca_web_app_backend.core import worker_tasks_topic


def test_run_topic_modeling_task_emits_representative_words_as_list_string(
    tmp_path, monkeypatch
):
    class FakeEmbedder:
        def encode(self, docs, show_progress_bar=False):
            assert show_progress_bar is False
            return np.array([[0.1, 0.2] for _ in docs], dtype=float)

    class FakeBERTopic:
        def __init__(self, *, verbose, min_topic_size, embedding_model, umap_model):
            assert verbose is False
            assert min_topic_size == 2
            assert embedding_model is not None
            assert umap_model is not None
            self.c_tf_idf_ = np.array([[1.0, 0.5]], dtype=float)
            self.topic_embeddings_ = np.array([[0.2, 0.4]], dtype=float)

        def fit_transform(self, docs, embeddings):
            assert docs == ["doc one", "doc two"]
            assert embeddings.shape == (2, 2)
            return [0, 0], None

        def get_topic_freq(self):
            return pd.DataFrame({"Topic": [0, -1], "Count": [2, 0]})

        def get_topic(self, topic_id):
            assert topic_id == 0
            return [("alpha", 0.9), ("beta", 0.8), ("gamma", 0.7)]

        def get_topics(self):
            return {
                -1: [],
                0: self.get_topic(0),
            }

    def fake_select_topic_representation(*_args, **_kwargs):
        return np.array([[0.0, 0.0], [1.0, 2.0]], dtype=float), False

    bertopic_module = ModuleType("bertopic")
    bertopic_module.BERTopic = FakeBERTopic
    bertopic_utils_module = ModuleType("bertopic._utils")
    bertopic_utils_module.select_topic_representation = fake_select_topic_representation

    monkeypatch.setattr(
        worker_tasks_topic, "_get_embedder", lambda _name: FakeEmbedder()
    )
    monkeypatch.setitem(sys.modules, "bertopic", bertopic_module)
    monkeypatch.setitem(sys.modules, "bertopic._utils", bertopic_utils_module)

    result = worker_tasks_topic.run_topic_modeling_task(
        configure_worker_environment=lambda: None,
        user_id="test-user",
        workspace_id="test-workspace",
        corpora=[["doc one", "doc two"]],
        node_infos=[
            {
                "node_id": "node-1",
                "node_name": "Node 1",
                "text_column": "document",
                "original_columns": ["document"],
            }
        ],
        artifact_dir=str(tmp_path),
        artifact_prefix="topic_modeling_test",
        min_topic_size=2,
    )

    meanings = pl.read_parquet(tmp_path / "topic_modeling_test_topic_meanings.parquet")
    assignments = pl.read_parquet(
        tmp_path / "topic_modeling_test_topic_assignments_node-1.parquet"
    )

    assert assignments.columns == ["__row_nr__", "TOPIC_topic"]
    assert meanings.schema["TOPIC_topic_meaning"] == pl.List(pl.String)
    assert meanings.to_dicts() == [
        {
            "TOPIC_topic": 0,
            "TOPIC_topic_meaning": ["alpha", "beta", "gamma"],
        }
    ]
    assert result["topics"][0]["representative_words"] == ["alpha", "beta", "gamma"]
    assert result["topics"][0]["label"] == "alpha | beta | gamma"
