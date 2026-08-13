"""Static ownership rules for the hard-cutover backend architecture."""

from __future__ import annotations

import ast
from pathlib import Path


PACKAGE_ROOT = Path(__file__).parents[2] / "src" / "ldaca_wordflow"


def _imports(module_path: Path) -> set[str]:
    tree = ast.parse(module_path.read_text(encoding="utf-8"))
    imports: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            relative = "." * node.level
            imports.add(f"{relative}{node.module or ''}")
    return imports


def test_domain_layers_never_import_the_http_api() -> None:
    offenders: list[str] = []
    for layer in (
        "analysis",
        "domain",
        "infrastructure",
        "services",
        "shared",
        "workers",
    ):
        for path in (PACKAGE_ROOT / layer).rglob("*.py"):
            if any(
                imported.startswith("ldaca_wordflow.api")
                or imported.startswith("..api")
                or imported.startswith("...api")
                for imported in _imports(path)
            ):
                offenders.append(str(path.relative_to(PACKAGE_ROOT)))
    assert offenders == []


def test_inner_layers_do_not_depend_on_use_cases_or_http() -> None:
    forbidden_by_layer = {
        "shared": ("api", "services", "infrastructure", "analysis", "workers"),
        "domain": ("api", "services", "infrastructure", "workers"),
        "infrastructure": ("api", "services"),
        "analysis": ("api", "services"),
        "workers": ("api", "services"),
    }
    offenders: list[str] = []
    for layer, forbidden in forbidden_by_layer.items():
        for path in (PACKAGE_ROOT / layer).rglob("*.py"):
            imports = _imports(path)
            if any(
                imported.startswith(f"ldaca_wordflow.{target}")
                or imported.startswith(f"..{target}")
                or imported.startswith(f"...{target}")
                for imported in imports
                for target in forbidden
            ):
                offenders.append(str(path.relative_to(PACKAGE_ROOT)))
    assert offenders == []


def test_app_factory_and_environment_bootstrap_are_separate() -> None:
    main_source = (PACKAGE_ROOT / "main.py").read_text(encoding="utf-8")
    asgi_source = (PACKAGE_ROOT / "asgi.py").read_text(encoding="utf-8")

    assert "app = create_app(" not in main_source
    assert "load_settings" not in main_source
    assert "app = create_app(load_settings(), serve_frontend=False)" in asgi_source


def test_removed_facades_and_duplicate_modules_stay_absent() -> None:
    removed = (
        "analysis/manager.py",
        "analysis/persistence.py",
        "core/api_models.py",
        "core/utils.py",
        "core/worker_task_manager.py",
        "core/workspace.py",
        "api/admin.py",
        "api/config.py",
        "core/exceptions.py",
        "core/json_data.py",
        "core/serialization.py",
        "core/worker_tasks_concordance.py",
        "core/worker_tasks_quotation.py",
        "core/worker_tasks_sequential.py",
        "core/worker_tasks_token.py",
        "core/worker_tasks_topic.py",
        "core/worker_input_snapshots.py",
    )
    assert [path for path in removed if (PACKAGE_ROOT / path).exists()] == []
    assert not (PACKAGE_ROOT / "core").exists()
    assert not (PACKAGE_ROOT / "analysis" / "implementations").exists()


def test_curated_vendor_surface_is_exact() -> None:
    vendor = PACKAGE_ROOT / "_vendor"
    assert (vendor / "gender_gap_tracker" / "quote_extractor.py").is_file()
    assert (vendor / "gender_gap_tracker" / "LICENSE").is_file()
    assert not (vendor / "rocrate_tabular" / "tabulator.py").exists()
    assert not (vendor / "rocrate-tabular").exists()
    assert not (vendor / "GenderGapTracker").exists()


def test_persisted_analysis_workers_accept_only_snapshot_inputs() -> None:
    expected = {
        "concordance.py": (
            ("run_concordance_run_all",),
            {"node_corpus", "node_tokens", "extra_columns_data"},
        ),
        "quotation.py": (
            ("run_quotation_run_all",),
            {"node_corpus", "extra_columns_data", "engine_config"},
        ),
        "sequential.py": (("run_sequential_analysis",), set()),
        "topic_modeling.py": (("run_topic_modeling_analysis",), {"corpora"}),
        "token_frequency.py": (
            ("run_token_frequency_analysis",),
            {"node_corpora", "node_token_streams", "node_display_names"},
        ),
    }
    for filename, (function_names, forbidden_parameters) in expected.items():
        tree = ast.parse(
            (PACKAGE_ROOT / "workers" / filename).read_text(encoding="utf-8")
        )
        for function_name in function_names:
            function = next(
                node
                for node in tree.body
                if isinstance(node, ast.FunctionDef) and node.name == function_name
            )
            parameters = {
                argument.arg
                for argument in (*function.args.args, *function.args.kwonlyargs)
            }
            assert "input_snapshot_dir" in parameters
            assert "configure_worker_environment" not in parameters
            assert parameters.isdisjoint(forbidden_parameters)


def test_workers_never_publish_terminal_or_failure_sentinel_progress() -> None:
    for path in (PACKAGE_ROOT / "workers").glob("*.py"):
        source = path.read_text(encoding="utf-8")
        assert "progress_callback(1.0" not in source, path.name
        assert "progress_callback(-1" not in source, path.name
