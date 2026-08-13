from __future__ import annotations

import argparse
import json
from pathlib import Path

from ldaca_wordflow.main import create_app
from ldaca_wordflow.settings import load_settings


def export_openapi(output_path: Path) -> None:
    # Schema export performs application wiring only. It deliberately disables
    # frontend asset probing and never enters lifespan/runtime allocation.
    app = create_app(load_settings(), serve_frontend=False)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export the LDaCA Wordflow FastAPI OpenAPI schema."
    )
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Path to write the OpenAPI schema.",
    )
    args = parser.parse_args()
    export_openapi(args.output)


if __name__ == "__main__":
    main()
