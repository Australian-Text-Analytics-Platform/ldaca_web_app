# CILogon Secrets Runbook

CILogon client secrets never belong in Git, GitHub Actions variables, service
unit text, shell history, or frontend configuration. Wordflow reads the secret
only from `CILOGON_CLIENT_SECRET` at backend startup.

## Secret Manager

The current Google Cloud Secret Manager name is
`LDACA_CILOGON_CLIENT_SECRET` in project `prime-odyssey-387018`. Authenticate
with an operator identity rather than memorizing a secret:

```bash
gcloud auth login
gcloud config set project prime-odyssey-387018
gcloud secrets describe LDACA_CILOGON_CLIENT_SECRET
```

On a server, prefer workload identity or a service account authorized only for
`secretmanager.versions.access`. Fetch the value into the root-owned service
environment file:

```bash
sudo install -d -m 700 /etc/ldaca-wordflow
secret="$(gcloud secrets versions access latest \
  --project=prime-odyssey-387018 \
  --secret=LDACA_CILOGON_CLIENT_SECRET)"
printf 'CILOGON_CLIENT_SECRET=%s\n' "$secret" \
  | sudo tee /etc/ldaca-wordflow/secrets.env >/dev/null
sudo chmod 600 /etc/ldaca-wordflow/secrets.env
unset secret
```

Do not print or verify the value itself. Verify only that access succeeds and
the file has the expected owner/mode.

## Provider Configuration

The service definition contains the non-secret client ID, exact redirect URI,
and `CILOGON_ISSUER`. Use the issuer origin only; Wordflow derives the discovery
URL. Test and production issuers are separate registrations and must match the
configured client and callback.

## Rotation

1. Create or obtain the replacement credential from the authorized CILogon
   operator.
2. Add a new Secret Manager version without deleting the previous version.
3. Fetch `latest` into the server environment file and restart Wordflow.
4. Complete a login and logout smoke test.
5. Disable the previous provider credential and old Secret Manager version.
6. Record the rotation date and operator in the deployment system, never the
   secret value.

If a secret was committed, removal from the current tree is insufficient:
revoke it at CILogon, rotate it in Secret Manager, and treat Git history as
compromised material.
