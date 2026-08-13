"""Environment-backed ASGI bootstrap for production server imports."""

from .main import create_app
from .settings import load_settings


app = create_app(load_settings(), serve_frontend=False)


__all__ = ["app"]
