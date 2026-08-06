---
status: accepted
superseded_by: 0015-generic-tab-owned-analysis-forests
---

# Separate Preview Sessions, Run All, and Review

> Superseded by [ADR 0015](0015-generic-tab-owned-analysis-forests.md). The
> durable Preview query and Review distinctions remain, but Preview is no
> longer a privileged root and Run All is no longer required to be its direct
> child.

Interactive Preview, complete execution, and review have different ownership.
Wordflow therefore represents Preview as a durable root Analysis containing an
immutable request and input snapshot. POST Result queries recompute requested
pages; GET returns only the durable readiness marker. Preview pages are neither
cached Analysis Results nor frontend-owned session state.

Run All is a direct typed Child Analysis. Annotation Run All edits the selected
source column in place. Concordance and Quotation Run All publish Result Data
Blocks. Review reads current durable state rather than replaying Preview:
Annotation reads the edited source, Quotation reads its Result Data Block, and
Concordance left-joins current source rows to result rows on the selected text
column. Duplicate text follows ordinary relational multiplication.

This strict cutover removes standalone Annotation preview routes, per-Result
Data Block Creation commands, and the former Concordance dispersion creation
path. Native Workspace schema 8 and portable archive format 7 reject older
layouts without runtime migration.
