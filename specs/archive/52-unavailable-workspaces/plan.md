# Implementation Plan

1. Add a typed native-schema mismatch and lightweight unavailable classification
   to owned Workspace catalogue discovery.
2. Expose a discriminated `WorkspaceListItem` API while keeping all strict
   `WorkspaceResource` endpoints unchanged.
3. Regenerate the frontend client and retain the full catalogue in the existing
   TanStack Query cache while deriving available Workspaces for runtime use.
4. Render unavailable UUID cards and serialize all Workspace selection controls,
   retaining normalized transient failures for deeper Load errors.
5. Align glossary, domain, architecture, API reference, and format-version
   documentation.
6. Run full package and documentation checks, complete Browser acceptance against
   the existing schema 15, 14, and 13 catalogue, then archive this specification.
