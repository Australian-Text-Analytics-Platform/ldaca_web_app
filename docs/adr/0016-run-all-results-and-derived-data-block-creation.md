# Separate Run All Results From Derived Data Block Creation

Concordance and Quotation Run All retain complete immutable Result tables and
never create Workspace Data Blocks directly. A separate typed Supporting
Analysis publishes user-selected Result columns because computation, Review,
and graph mutation have different lifecycles and failure boundaries.
Annotation remains the explicit in-place exception: its Run All operation edits
the selected annotation column rather than creating a Derived Data Block.

## Consequences

- Review is available from the successful Analysis even when no Derived Data
  Block has been created in the Workspace.
- Derived Data Block Creation requires the document column, records an immutable
  selection, and commits all requested sources atomically.
- Two-source Concordance keeps its thin Run All group and per-source Supporting
  Results; Derived Data Block Creation is another child of the successful group.
- Native Workspace schema 15 and portable archive format 14 are clean cutovers.
  No reader or runtime migration accepts the superseded output-Data-Block
  contract.

This decision supersedes ADR 0014's Concordance and Quotation Review/output
contract and ADR 0015 only where it described Concordance Run All children as
directly publishing output Data Blocks.
