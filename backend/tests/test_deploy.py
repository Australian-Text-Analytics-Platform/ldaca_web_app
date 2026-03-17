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
    task_marker = object()

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


def test_start_frontend_requires_explicit_frontend_dir() -> None:
    try:
        deploy.start_frontend(port=3000)
    except ValueError as exc:
        assert str(exc) == "frontend_dir must be provided explicitly"
    else:
        raise AssertionError("start_frontend accepted an implicit frontend_dir")


def test_start_frontend_builds_explicit_frontend_dir(
    monkeypatch,
    tmp_path: Path,
) -> None:
    template_path = tmp_path / "nginx.conf.template"
    template_path.write_text("server {}", encoding="utf-8")
    commands: list[str] = []
    proc = object()

    class FakeResourceRoot:
        def joinpath(self, _name: str) -> Path:
            return template_path

    @contextmanager
    def fake_as_file(path: Path):
        yield path

    def fake_run(command: str, check: bool, shell: bool):
        assert check is True
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

    expected_frontend_dir = tmp_path / "frontend"
    expected_build_dir = tmp_path / "build"

    result = deploy.start_frontend(
        port=3000,
        frontend_dir=expected_frontend_dir,
        build_dir=expected_build_dir,
    )

    assert result is proc
    assert commands[0] == (
        f"cd {expected_frontend_dir} && npm install > /dev/null 2>&1 && "
        f"npm run build -- --outDir {expected_build_dir} > /dev/null 2>&1"
    )
    assert f"FRONTEND_DIR={expected_build_dir}" in commands[1]
    assert "BACKEND_PORT=8123" in commands[1]
    assert "MIME_TYPES_PATH=/opt/homebrew/etc/nginx/mime.types" in commands[1]
