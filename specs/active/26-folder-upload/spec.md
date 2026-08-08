# Unified Folder-Aware Uploads

Issue: [#26](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/26)

## Accepted behavior

- The Data Loader keeps **Upload files** and adds **Upload folder**. Folder
  picking selects one directory and preserves its root and descendants.
- Browser file picking, folder picking, loose-file drops, and mixed file/folder
  drops all produce User File paths through one upload-selection workflow.
- Folder drop uses the feature-detected Entries API exposed through
  `webkitGetAsEntry()`. Folder picking is the reliable fallback. Chrome,
  Safari, and packaged macOS Tauri share this web implementation.
- Loose files and selected folder roots are placed at the User File root.
  Nested structure is preserved, while source-empty directories are not
  created.
- Dot-prefixed entries and case-insensitive `Thumbs.db` files are skipped.
  One skipped directory counts once and is not traversed.

## Preflight and execution

Before the first mutation, the client refreshes the complete unfiltered User
File tree, validates portable paths, and reports all internal and destination
conflicts in one dialog. Any conflict rejects the complete selection. Existing
directories are reusable, but existing files are never overwritten.

Missing directories are created parent-first. Files upload sequentially in
deterministic relative-path order. Cancel is cooperative: the current request
finishes and no next request starts. Execution stops at the first error. A
late folder-create conflict is reusable only when a resource read verifies the
destination is a directory.

Files and folders already created before cancellation, failure, or a race are
retained. One final tree refresh follows any mutating attempt. Progress and the
terminal message report the phase, completed file count, failure path when
applicable, and hidden-entry skip counts.

## Compatibility boundary

- Tauri retains `dragDropEnabled: false` so HTML drag events reach the webview.
- No native filesystem path, `getAsFileSystemHandle()`, backend endpoint, or
  OpenAPI change is introduced.
- Firefox and Windows Tauri are not release gates for this change.
- Preflight is snapshot-based. Existing backend conflict checks remain the
  race-condition backstop.

## Non-goals

- Arbitrary filesystem access after the explicit picker or drop interaction.
- Creating source-empty folders.
- Transactional rollback of partially completed uploads.
- Adding a client-side file-count limit.
- Changing User File or User File Import domain semantics.
