"""Command-line interface contracts."""

from ldaca_wordflow.cli import _parse_args


def test_reverse_proxy_root_path_is_explicit() -> None:
    args = _parse_args(["--root-path", "/deployment/prefix"])

    assert args.root_path == "/deployment/prefix"
