# Plan

1. Replace the backend gitlink with the frozen source snapshot and verify the
   imported tree against its recorded Git tree.
2. Consolidate source-aware frontend/backend CI and separate manual desktop
   publication from tag-triggered backend publication.
3. Update ownership documentation, clone-upgrade instructions, and package
   links.
4. Validate locally, push the feature branch, and require source-aware CI plus
   non-publishing desktop builds.
5. Fast-forward `dev`, then `main` only while ancestry remains safe.
6. Configure the root PyPI trusted publisher, retire the standalone workflows,
   point its default branch to the monorepo, and archive it.
7. Complete this specification and close issue #59 after all rollout evidence
   is recorded.
