---
status: accepted
---

# Make exclusive Workspace runtime state backend authoritative

Open Workspace residency controls which aggregate accepts child-resource
commands, so it cannot be inferred safely from browser memory. A remembered
client selection can outlive backend restart, explicit close, Analysis-driven
closing, another browser's switch, or a failed open command. Treating that
selection as an authority creates two incompatible lifecycle state machines.

The backend therefore permits at most one `open` Workspace per user. A
short-lived per-user lifecycle gate serializes open, close, and delete
commands, while existing per-Workspace gates continue to serialize aggregate
access and mutation. Opening validates the target before switching, requests
closure of every open sibling, then opens the target. Idle siblings close
immediately and busy siblings may remain `closing`; multiple closing
Workspaces are valid. Reopening a closing target makes it the sole open
Workspace. Different users retain independent gates and runtime state.

If target opening fails after sibling closure has begun, the backend leaves
those real transitions visible and returns the underlying error. It does not
invent a rollback that could disagree with admitted Analysis work. Every
runtime transition publishes a refresh event.

The frontend derives its current Workspace exclusively from the complete
Workspace resource collection observed through TanStack Query. Zero open
resources means no current Workspace, one is the current Workspace, and more
than one is rendered as an invariant violation rather than resolved by an
arbitrary choice. Device storage does not retain a last Workspace ID and never
automatically opens a resource. URL state and device-local active Tabs remain
presentation mechanisms, not Workspace lifecycle authorities.

This makes backend restart and explicit close visible instead of silently
reopening prior work. It also makes switching while Analysis work drains
predictable: one Workspace can accept new commands while older siblings finish
closing, without allowing two open aggregates for the same user.
