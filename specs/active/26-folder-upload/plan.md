# Implementation Plan

1. Add a pure upload-selection adapter for picker paths, repeated Entries API
   traversal, hidden-entry filtering, portable validation, directory
   derivation, and complete-tree conflict detection.
2. Retain the complete User File tree in `useFiles`, derive the existing
   loadable presentation tree, and expose exception-preserving path-aware file,
   directory, resource-read, and refresh operations.
3. Replace the former multi-file loop with a phase-based upload coordinator
   that preflights the whole selection, executes deterministically, supports
   cooperative cancellation, fails fast, and refreshes once after mutation.
4. Add the folder picker, folder-aware drop guidance, accessible progress and
   Cancel controls, and a bounded full-conflict dialog to the Data Loader.
5. Update current architecture and bundled/published user documentation, then
   validate Chrome, Safari, and packaged macOS Tauri compatibility.
6. Run the complete frontend and documentation checks and replace the issue's
   older implementation-plan comment with this contract.
