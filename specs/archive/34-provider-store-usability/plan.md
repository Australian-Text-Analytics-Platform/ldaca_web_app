# Implementation Plan

1. Relax configuration validation while preserving UUID and locator identity.
2. Replace rename-only PATCH with a strict partial name/credential update.
3. Normalize provider failures and preserve safe fatal worker failures.
4. Publish only trustworthy Run All rows with a separate failed-row mask.
5. Update browser storage, the mode facade, Settings, and Annotation selection.
6. Regenerate OpenAPI and add backend and frontend regression coverage.
7. Record the domain decisions, update user and developer documentation, run
   controlled acceptance, and archive this specification.
