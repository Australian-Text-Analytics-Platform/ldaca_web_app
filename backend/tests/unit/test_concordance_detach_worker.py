from ldaca_web_app_backend.core import worker


def test_concordance_detach_task_forwards_extra_columns_data(monkeypatch):
    captured: dict[str, object] = {}

    def fake_run_concordance_detach_task(
        configure_worker_environment,
        node_corpus,
        parent_node_id,
        document_column,
        search_word,
        num_left_tokens,
        num_right_tokens,
        regex,
        case_sensitive,
        new_node_name,
        artifact_dir,
        artifact_prefix,
        include_document_column=False,
        extra_columns_data=None,
        progress_callback=None,
    ):
        captured["include_document_column"] = include_document_column
        captured["extra_columns_data"] = extra_columns_data
        return {"state": "successful"}

    monkeypatch.setattr(
        worker, "run_concordance_detach_task", fake_run_concordance_detach_task
    )

    result = worker.concordance_detach_task(
        user_id="user-1",
        workspace_id="ws-1",
        node_corpus=["alpha beta"],
        parent_node_id="node-1",
        document_column="document",
        search_word="alpha",
        num_left_tokens=2,
        num_right_tokens=2,
        regex=False,
        case_sensitive=False,
        new_node_name="node_1_conc",
        artifact_dir="/tmp",
        artifact_prefix="conc_detach",
        include_document_column=True,
        extra_columns_data={"source": ["a"]},
    )

    assert result == {"state": "successful"}
    assert captured["include_document_column"] is True
    assert captured["extra_columns_data"] == {"source": ["a"]}
