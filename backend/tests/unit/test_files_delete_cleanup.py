from ldaca_web_app_backend.core.utils import get_user_data_folder


async def test_delete_file_removes_parent_folder_when_only_readme_remains(
    authenticated_client,
):
    user_data_folder = get_user_data_folder("test")
    corpus_folder = user_data_folder / "LDaCA" / "Corpus_Name"
    corpus_folder.mkdir(parents=True, exist_ok=True)

    data_file = corpus_folder / "Corpus_Name.parquet"
    data_file.write_text("parquet-bytes-placeholder", encoding="utf-8")
    readme_file = corpus_folder / "README.md"
    readme_file.write_text("# Corpus info", encoding="utf-8")

    response = await authenticated_client.delete(
        "/api/files/LDaCA/Corpus_Name/Corpus_Name.parquet"
    )

    assert response.status_code == 200
    assert not data_file.exists()
    assert not readme_file.exists()
    assert not corpus_folder.exists()


async def test_delete_file_keeps_parent_folder_when_other_files_remain(
    authenticated_client,
):
    user_data_folder = get_user_data_folder("test")
    corpus_folder = user_data_folder / "LDaCA" / "Corpus_Name"
    corpus_folder.mkdir(parents=True, exist_ok=True)

    data_file = corpus_folder / "Corpus_Name.parquet"
    data_file.write_text("parquet-bytes-placeholder", encoding="utf-8")
    readme_file = corpus_folder / "README.md"
    readme_file.write_text("# Corpus info", encoding="utf-8")
    sibling_file = corpus_folder / "extra.csv"
    sibling_file.write_text("text\nhello", encoding="utf-8")

    response = await authenticated_client.delete(
        "/api/files/LDaCA/Corpus_Name/Corpus_Name.parquet"
    )

    assert response.status_code == 200
    assert not data_file.exists()
    assert readme_file.exists()
    assert sibling_file.exists()
    assert corpus_folder.exists()
