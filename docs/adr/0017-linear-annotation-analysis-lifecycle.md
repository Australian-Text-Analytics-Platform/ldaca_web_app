# Linear Annotation Analysis Lifecycle

Annotation Preview and Run All use one linear Tab-owned Analysis lifecycle.
Every accepted Preview or Run All submission immediately removes the prior
terminal Annotation Analysis and creates the sole replacement root. Annotation
does not use parents, Supporting Analyses, or success-dependent explicit
supersession.

This keeps Annotation's in-place workflow aligned with its interface: Preview
is replaced by Run All, and each later Run All replaces the preceding attempt.
The Task Inbox therefore exposes only the current Annotation task instead of
retaining failed or successful predecessors beside it.

## Consequences

- A rejected request leaves the existing Annotation Analysis unchanged because
  replacement occurs only after request and input validation.
- Once a replacement is accepted, the predecessor is not restored if scheduling
  or execution later fails.
- Other Analysis kinds retain generic Tab-owned forests, arbitrary-depth
  Supporting Analyses, and success-dependent explicit supersession.

This decision supersedes ADR 0015 only for Annotation Tab ownership and
replacement. The generic Analysis forest remains the contract for every other
analysis kind.
