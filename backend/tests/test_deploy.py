from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

from ldaca_web_app_backend import deploy


def test_start_backend_updates_settings_backend_port(
    monkeypatch,
) -> None:
    original_backend_port = deploy.settings.backend_port
    monkeypatch.setattr(deploy.settings, "backend_port", original_backend_port)
    monkeypatch.setattr(deploy, "_server", None)
    monkeypatch.setattr(deploy, "_server_task", None)

    created_config: dict[str, object] = {}
    task_callbacks: list[object] = []

    class FakeTask:
        def add_done_callback(self, callback) -> None:
            task_callbacks.append(callback)

    task_marker = FakeTask()

    class FakeLoop:
        def create_task(self, coroutine):
            coroutine.close()
            return task_marker

    class FakeServer:
        def __init__(self, config) -> None:
            self.config = config
            self.started = False

        async def serve(self) -> None:
            return None

    def fake_config(app, host, port, reload, log_level):
        created_config.update({
            "app": app,
            "host": host,
            "port": port,
            "reload": reload,
            "log_level": log_level,
        })
        return SimpleNamespace(port=port)

    monkeypatch.setattr(deploy.uvicorn, "Config", fake_config)
    monkeypatch.setattr(deploy.uvicorn, "Server", FakeServer)
    monkeypatch.setattr(deploy.asyncio, "get_running_loop", lambda: FakeLoop())

    result = deploy.start_backend(port=8123)

    assert result is task_marker
    assert created_config["port"] == 8123
    assert deploy.settings.backend_port == 8123
    assert task_callbacks == [deploy._clear_backend_state]


def test_start_backend_reuses_existing_task(monkeypatch) -> None:
    existing_task = SimpleNamespace(done=lambda: False)

    monkeypatch.setattr(deploy.settings, "backend_port", 8123)
    monkeypatch.setattr(deploy, "_server", SimpleNamespace(started=False))
    monkeypatch.setattr(deploy, "_server_task", existing_task)
    monkeypatch.setattr(
        deploy.uvicorn,
        "Config",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("unexpected")),
    )

    result = deploy.start_backend(port=9000)

    assert result is existing_task
    assert deploy.settings.backend_port == 8123


def test_start_frontend_requires_explicit_build_dir() -> None:
    try:
        deploy.start_frontend(port=3000)
    except ValueError as exc:
        assert str(exc) == "build_dir must be provided explicitly"
    else:
        raise AssertionError("start_frontend accepted an implicit build_dir")


def test_start_frontend_requires_prebuilt_index_html(
    tmp_path: Path,
) -> None:
    missing_build_dir = tmp_path / "build"
    missing_build_dir.mkdir()

    try:
        deploy.start_frontend(port=3000, build_dir=missing_build_dir)
    except FileNotFoundError as exc:
        assert str(missing_build_dir.resolve() / "index.html") in str(exc)
    else:
        raise AssertionError("start_frontend accepted a build_dir without index.html")


def test_start_frontend_uses_existing_build_dir_and_cleans_nginx_runtime(
    monkeypatch,
    tmp_path: Path,
) -> None:
    template_path = tmp_path / "nginx.conf.template"
    template_path.write_text("server {}", encoding="utf-8")
    commands: list[str] = []
    proc = object()
    process_events: list[str] = []

    class FakeResourceRoot:
        def joinpath(self, _name: str) -> Path:
            return template_path

    class FakeRunningProcess:
        def poll(self):
            return None

        def terminate(self) -> None:
            process_events.append("terminate")

        def wait(self, timeout: float | None = None) -> None:
            process_events.append(f"wait:{timeout}")

    @contextmanager
    def fake_as_file(path: Path):
        yield path

    def fake_run(
        command: str,
        check: bool,
        shell: bool,
        stdout=None,
        stderr=None,
    ):
        assert shell is True
        commands.append(command)
        return SimpleNamespace(returncode=0)

    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("JUPYTERHUB_SERVICE_PREFIX", "/user/test")
    monkeypatch.setattr(deploy, "IPYTHON_AVAILABLE", True)
    monkeypatch.setattr(deploy, "ON_COLAB", False)
    monkeypatch.setattr(deploy, "display", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(deploy, "Javascript", lambda script: script)
    monkeypatch.setattr(deploy, "Markdown", lambda text: text)
    monkeypatch.setattr(deploy.resources, "files", lambda _pkg: FakeResourceRoot())
    monkeypatch.setattr(deploy.resources, "as_file", fake_as_file)
    monkeypatch.setattr(deploy.subprocess, "run", fake_run)
    monkeypatch.setattr(
        deploy.subprocess,
        "Popen",
        lambda command, shell: proc,
    )
    monkeypatch.setattr(
        deploy,
        "_resolve_nginx_mime_types_path",
        lambda: Path("/opt/homebrew/etc/nginx/mime.types"),
    )
    monkeypatch.setattr(deploy.settings, "backend_port", 8123)
    monkeypatch.setattr(deploy, "_nginx_proc", FakeRunningProcess())

    expected_build_dir = tmp_path / "build"
    expected_build_dir.mkdir()
    (expected_build_dir / "index.html").write_text("<html></html>", encoding="utf-8")

    nginx_dir = tmp_path / "nginx"
    (nginx_dir / "run").mkdir(parents=True)
    (nginx_dir / "tmp" / "client_body").mkdir(parents=True)
    (nginx_dir / "logs").mkdir(parents=True)
    (nginx_dir / "nginx.conf").write_text("server {}", encoding="utf-8")
    (nginx_dir / "run" / "nginx.pid").write_text("12345", encoding="utf-8")

    result = deploy.start_frontend(
        port=3000,
        build_dir=expected_build_dir,
    )

    assert result is proc
    assert process_events == ["terminate", "wait:5"]
    assert commands[0] == f"nginx -p {nginx_dir} -c nginx.conf -s quit"
    assert f"FRONTEND_DIR={expected_build_dir}" in commands[1]

    assert "MIME_TYPES_PATH=/opt/homebrew/etc/nginx/mime.types" in commands[1]
    assert not (nginx_dir / "run" / "nginx.pid").exists()
    assert (nginx_dir / "logs").exists()
    assert (nginx_dir / "tmp").exists()
    assert not (nginx_dir / "tmp" / "client_body").exists()
    assert result is proc
