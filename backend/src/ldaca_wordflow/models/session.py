"""Cookie and process-backed session API models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class SessionUser(BaseModel):
    """Authenticated identity safe to expose to a bundled client."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    email: str
    name: str
    picture: str | None = None


class AuthProvider(BaseModel):
    """One configured hosted login provider."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: Literal["google", "cilogon"]
    display_name: str
    entrypoint_url: str


class SessionResponse(BaseModel):
    """No-store bootstrap response for both supported deployment profiles."""

    model_config = ConfigDict(extra="forbid")

    mode: Literal["multi_user", "single_user"]
    authenticated: bool
    user: SessionUser | None
    providers: list[AuthProvider]
    google_client_id: str | None = None
    csrf_token: str | None = None
