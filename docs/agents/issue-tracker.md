# Issue Tracker: GitHub

Wordflow issues, specifications, and engineering tickets are coordinated in
GitHub Issues for `Australian-Text-Analytics-Platform/ldaca-wordflow`. Use the
`gh` CLI from this checkout so it infers the repository from `origin`.

## Operations

- Create: `gh issue create --title "..." --body-file <file>`
- Read with discussion: `gh issue view <number> --comments`
- List: `gh issue list --state open --json number,title,body,labels,assignees`
- Comment: `gh issue comment <number> --body-file <file>`
- Label or assign: `gh issue edit <number> --add-label "..." --add-assignee @me`
- Close: `gh issue close <number> --comment "..."`

When a skill says to publish to the issue tracker, create a GitHub issue. When
it says to fetch a ticket, read the issue and its comments. Pull requests are
not a feature-request or triage surface.

Substantial changes may additionally use `specs/active/<issue>-<slug>/`. The
GitHub issue coordinates ownership and discussion; the checked-in specification
holds the accepted behavior, plan, and verification record.
