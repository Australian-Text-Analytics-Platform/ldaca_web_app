"""Runtime-scoped Google and CILogon identity-provider integration.

The service owns immutable provider configuration and its discovery cache.
Routes own cookies, provider state validation, and redirects; this service owns
blocking/network verification and local user provisioning only.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import cast
from urllib.parse import urlsplit

import anyio
import httpx
from google.auth.exceptions import GoogleAuthError, TransportError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from ..shared.json_data import JsonData
from anyio.to_thread import run_sync as run_sync_in_worker_thread

from ..shared.errors import BadGatewayError, InvalidInputError
from ..models.session import SessionUser
from ..settings import Settings
from .sessions import SessionService


class OAuthService:
    """Verify provider identities and map them into local users."""

    def __init__(
        self,
        settings: Settings,
        sessions: SessionService,
        *,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.settings = settings
        self.sessions = sessions
        self._cilogon_config: dict[str, JsonData] | None = None
        self._discovery_lock = anyio.Lock()
        self._http_client = http_client or httpx.AsyncClient()

    async def close(self) -> None:
        """Close the runtime-owned OIDC connection pool."""

        await self._http_client.aclose()

    async def verify_google(self, credential: str) -> SessionUser:
        """Verify one Google ID credential and provision its verified identity."""

        if not self.settings.multi_user or not self.settings.google_client_id:
            raise InvalidInputError("Google authentication is not configured")
        try:
            info = await run_sync_in_worker_thread(
                google_id_token.verify_oauth2_token,
                credential,
                google_requests.Request(),
                self.settings.google_client_id,
                abandon_on_cancel=False,
            )
        except TransportError as exc:
            raise BadGatewayError(
                "Google identity verification is unavailable"
            ) from exc
        except (GoogleAuthError, ValueError) as exc:
            raise InvalidInputError("Invalid Google identity credential") from exc
        if info.get("email_verified") is not True:
            raise InvalidInputError("Google email is not verified")
        email = info.get("email")
        subject = info.get("sub")
        if (
            not isinstance(email, str)
            or not email
            or not isinstance(subject, str)
            or not subject
        ):
            raise InvalidInputError("Google identity is missing required claims")
        name = info.get("name")
        picture = info.get("picture")
        issuer = info.get("iss")
        if issuer not in {"accounts.google.com", "https://accounts.google.com"}:
            raise InvalidInputError("Google identity has an invalid issuer")
        expires_at = info.get("exp")
        if not isinstance(expires_at, int) or isinstance(expires_at, bool):
            raise InvalidInputError("Google identity is missing credential expiry")
        consumed = await self.sessions.database.consume_google_credential(
            hashlib.sha256(credential.encode("utf-8")).hexdigest(),
            expires_at,
            datetime.now(UTC).isoformat(),
        )
        if not consumed:
            raise InvalidInputError("Google identity credential was already used")
        return await self.sessions.upsert_oidc_user(
            issuer="https://accounts.google.com",
            subject=subject,
            email=email,
            name=name if isinstance(name, str) and name else email,
            picture=picture if isinstance(picture, str) else None,
        )

    async def cilogon_config(self) -> dict[str, JsonData]:
        """Fetch and cache one validated discovery document per runtime."""

        if self._cilogon_config is not None:
            return self._cilogon_config
        async with self._discovery_lock:
            if self._cilogon_config is not None:
                return self._cilogon_config
            try:
                response = await self._http_client.get(
                    self.settings.get_cilogon_discovery_url(),
                    timeout=10,
                )
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise BadGatewayError("CILogon discovery is unavailable") from exc
            try:
                payload = response.json()
            except ValueError as exc:
                raise BadGatewayError("CILogon discovery response is invalid") from exc
            if not isinstance(payload, dict):
                raise BadGatewayError("CILogon discovery response is invalid")
            required = {
                "issuer",
                "authorization_endpoint",
                "token_endpoint",
                "userinfo_endpoint",
            }
            if any(not isinstance(payload.get(field), str) for field in required):
                raise BadGatewayError("CILogon discovery response is incomplete")
            expected_issuer = self.settings.get_cilogon_issuer()
            if str(payload["issuer"]).rstrip("/") != expected_issuer:
                raise BadGatewayError(
                    "CILogon discovery issuer does not match configuration"
                )
            for field in (
                "authorization_endpoint",
                "token_endpoint",
                "userinfo_endpoint",
            ):
                _validate_issuer_endpoint(
                    expected_issuer,
                    str(payload[field]),
                    field,
                )
            self._cilogon_config = cast(dict[str, JsonData], payload)
            return self._cilogon_config

    async def complete_cilogon(
        self,
        *,
        code: str,
        redirect_uri: str,
        code_verifier: str,
    ) -> SessionUser:
        """Exchange one authorization code and provision its verified identity."""

        if not self.settings.multi_user or not self.settings.cilogon_client_id:
            raise InvalidInputError("CILogon authentication is not configured")
        config = await self.cilogon_config()
        try:
            token_response = await self._http_client.post(
                str(config["token_endpoint"]),
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "client_id": self.settings.cilogon_client_id,
                    "client_secret": (
                        self.settings.cilogon_client_secret.get_secret_value()
                    ),
                    "code_verifier": code_verifier,
                },
                timeout=15,
            )
            token_response.raise_for_status()
            try:
                tokens = token_response.json()
            except ValueError as exc:
                raise BadGatewayError("CILogon token response is invalid") from exc
            access_token = (
                tokens.get("access_token") if isinstance(tokens, dict) else None
            )
            if not isinstance(access_token, str) or not access_token:
                raise BadGatewayError("CILogon did not return an access token")
            userinfo_response = await self._http_client.get(
                str(config["userinfo_endpoint"]),
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=10,
            )
            userinfo_response.raise_for_status()
            try:
                userinfo = userinfo_response.json()
            except ValueError as exc:
                raise BadGatewayError("CILogon user information is invalid") from exc
        except BadGatewayError:
            raise
        except httpx.HTTPError as exc:
            raise BadGatewayError("CILogon authentication failed") from exc

        if not isinstance(userinfo, dict):
            raise BadGatewayError("CILogon user information is invalid")
        email_verified = userinfo.get("email_verified")
        if email_verified is False:
            raise InvalidInputError("CILogon email is not verified")
        if email_verified is not None and not isinstance(email_verified, bool):
            raise BadGatewayError("CILogon user information is invalid")
        email = userinfo.get("email")
        subject = userinfo.get("sub")
        if (
            not isinstance(email, str)
            or not email
            or not isinstance(subject, str)
            or not subject
        ):
            raise BadGatewayError("CILogon identity is missing required claims")
        raw_name = userinfo.get("name")
        if not isinstance(raw_name, str) or not raw_name.strip():
            given = userinfo.get("given_name")
            family = userinfo.get("family_name")
            raw_name = (
                " ".join(
                    value.strip()
                    for value in (given, family)
                    if isinstance(value, str) and value.strip()
                )
                or email
            )
        picture = userinfo.get("picture")
        return await self.sessions.upsert_oidc_user(
            issuer=self.settings.get_cilogon_issuer(),
            subject=subject,
            email=email,
            name=raw_name,
            picture=picture if isinstance(picture, str) else None,
        )


def _validate_issuer_endpoint(issuer: str, endpoint: str, field: str) -> None:
    """Keep discovery endpoints on the explicitly trusted HTTPS issuer origin."""

    try:
        expected = urlsplit(issuer)
        candidate = urlsplit(endpoint)
        trusted = (
            candidate.scheme == "https"
            and candidate.hostname is not None
            and candidate.hostname == expected.hostname
            and candidate.port == expected.port
            and candidate.username is None
            and candidate.password is None
            and not candidate.query
            and not candidate.fragment
        )
    except ValueError:
        trusted = False
    if not trusted:
        raise BadGatewayError(f"CILogon discovery {field} is not trusted")
