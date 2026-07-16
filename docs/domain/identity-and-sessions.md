# Identity And Sessions

Hosted and desktop deployments share protected API dependencies but establish
identity and unsafe-request proof differently.

```mermaid
flowchart TB
    REQUEST["Protected API request"] --> PROFILE{"Deployment profile"}

    PROFILE -->|"hosted multi-user"| COOKIE["HttpOnly Session cookie"]
    COOKIE --> SESSION["Server-side Session and user"]
    SESSION --> HOSTED_PROOF["Session CSRF token and exact Origin"]

    PROFILE -->|"desktop single-user"| PROCESS["Process identity"]
    PROCESS --> DESKTOP_PROOF["Process-scoped CSRF token and verified Tauri Origin"]

    HOSTED_PROOF --> AUTHORIZED["Current protected identity"]
    DESKTOP_PROOF --> AUTHORIZED
```

## Hosted Mode

Hosted multi-user Wordflow is a same-site browser deployment. A successful
identity-provider callback creates an independent server-side Session and an
HttpOnly cookie. Multiple Sessions may exist for one user; logout revokes only
the presented Session.

Unsafe requests require the Session's CSRF proof and an exact allowed Origin.
OAuth state, PKCE, nonce, and redirect validation protect provider callbacks.
Provider credentials and raw Session tokens are not public resources.

## Desktop Mode

Packaged desktop Wordflow is single-user and binds the backend to loopback. It
uses process identity and process-scoped CSRF rather than a browser Session or
bearer-token exception. The Tauri supervisor supplies the one verified desktop
Origin and owns backend restart and Data Root selection.

Cross-site multi-user desktop authentication is outside the supported product
model. It would require a same-origin bridge and dedicated packaged-WebView
security tests rather than a hidden alternate token transport.
