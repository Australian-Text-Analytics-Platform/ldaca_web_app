"""OIDC issuer, discovery, and upstream error boundaries."""

from __future__ import annotations

from typing import cast

import httpx
import pytest
from google.auth.exceptions import GoogleAuthError, TransportError

from ldaca_wordflow.shared.errors import BadGatewayError, InvalidInputError
from ldaca_wordflow.services import oauth as oauth_module
from ldaca_wordflow.services.oauth import OAuthService
from ldaca_wordflow.services.sessions import SessionService
from ldaca_wordflow.settings import Settings


class _Sessions:
    async def upsert_oidc_user(self, **_identity: object):
        raise AssertionError("Identity provisioning should not be reached")


def _settings() -> Settings:
    return Settings(
        multi_user=True,
        cilogon_client_id="client",
        cilogon_client_secret="secret",
        cilogon_redirect_uri="https://wordflow.example/api/auth/cilogon/callback",
        cilogon_issuer="https://issuer.example",
    )


def _discovery(**overrides: str) -> dict[str, str]:
    payload = {
        "issuer": "https://issuer.example",
        "authorization_endpoint": "https://issuer.example/authorize",
        "token_endpoint": "https://issuer.example/token",
        "userinfo_endpoint": "https://issuer.example/userinfo",
    }
    payload.update(overrides)
    return payload


@pytest.mark.anyio
async def test_discovery_rejects_mismatched_issuer_and_cross_origin_secret_target() -> (
    None
):
    responses = [
        httpx.Response(200, json=_discovery(issuer="https://other.example")),
        httpx.Response(
            200,
            json=_discovery(token_endpoint="https://attacker.example/token"),
        ),
        httpx.Response(200, json=_discovery(token_endpoint="https:path")),
    ]

    for response in responses:
        client = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _request, item=response: item)
        )
        service = OAuthService(
            _settings(),
            cast(SessionService, _Sessions()),
            http_client=client,
        )
        with pytest.raises(BadGatewayError):
            await service.cilogon_config()
        await service.close()


@pytest.mark.anyio
async def test_cilogon_maps_malformed_provider_json_to_safe_gateway_errors() -> None:
    def malformed_token(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("openid-configuration"):
            return httpx.Response(200, json=_discovery())
        assert b"code_verifier=verifier" in request.content
        return httpx.Response(200, content=b"not-json")

    service = OAuthService(
        _settings(),
        cast(SessionService, _Sessions()),
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(malformed_token)),
    )
    with pytest.raises(BadGatewayError, match="token response"):
        await service.complete_cilogon(
            code="code",
            redirect_uri="https://app/callback",
            code_verifier="verifier",
        )
    await service.close()

    def malformed_userinfo(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("openid-configuration"):
            return httpx.Response(200, json=_discovery())
        if request.url.path == "/token":
            return httpx.Response(200, json={"access_token": "opaque"})
        return httpx.Response(200, content=b"not-json")

    service = OAuthService(
        _settings(),
        cast(SessionService, _Sessions()),
        http_client=httpx.AsyncClient(
            transport=httpx.MockTransport(malformed_userinfo)
        ),
    )
    with pytest.raises(BadGatewayError, match="user information"):
        await service.complete_cilogon(
            code="code",
            redirect_uri="https://app/callback",
            code_verifier="verifier",
        )
    await service.close()


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("failure", "expected"),
    [
        (TransportError("network"), BadGatewayError),
        (GoogleAuthError("invalid"), InvalidInputError),
        (ValueError("invalid"), InvalidInputError),
    ],
)
async def test_google_verification_maps_provider_failures(
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception,
    expected: type[Exception],
) -> None:
    settings = Settings(multi_user=True, google_client_id="google-client")

    def fail_verification(*_args: object) -> object:
        raise failure

    monkeypatch.setattr(
        oauth_module.google_id_token,
        "verify_oauth2_token",
        fail_verification,
    )
    service = OAuthService(settings, cast(SessionService, _Sessions()))
    with pytest.raises(expected):
        await service.verify_google("credential")
    await service.close()
