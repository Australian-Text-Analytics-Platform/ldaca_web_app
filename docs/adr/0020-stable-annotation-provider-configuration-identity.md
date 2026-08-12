---
status: accepted
---

# Keep Annotation provider identity stable while credentials change

An Annotation Provider Configuration represents one user-managed connection
slot. Its opaque UUID is the durable identity. The provider type and normalized
Custom base URL form its immutable locator; the display name and optional
write-only credential may be updated without replacing the slot. Removing a
credential leaves the configuration visible so the user can repair it later.

Every provider, including built-ins, may be saved without a credential. A
keyless built-in cannot perform model discovery or inference and returns
`409 provider_credential_missing` at an execution boundary. A keyless Custom
provider remains usable because compatible endpoints may not require
authentication.

Configurations may repeat names, provider types, locators, and credentials.
Only UUID uniqueness is enforced. Deleting a selected configuration clears that
Tab's selected UUID, provider type, and current model instead of selecting a
different connection. Other configurations' remembered models remain intact.

Single-user mode owns the collection in
`users/root/provider-credentials.toml`; multi-user mode owns it in the current
browser partition. Credential changes affect subsequent model discovery,
Preview queries, and submissions. A Run All already admitted retains the
credential captured at submission. Frontend caches use UUID, immutable locator
metadata, and a safe credential revision, never a secret.

The stored fields have not changed, so TOML schema 2 and browser-storage version
2 remain current. The relaxed validation does not require migration.

This decision supersedes the clauses of
[ADR 0013](0013-multi-instance-annotation-provider-configurations.md) that
define provider-plus-credential as semantic identity, require credentials for
built-ins, reject duplicate configurations, or require credential rotation to
create a new UUID. ADR 0013's mode-specific ownership, immutable locator,
request snapshot, secret-handling, and Custom-destination decisions remain in
force.
