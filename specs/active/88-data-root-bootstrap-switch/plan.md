# Implementation Plan

1. Add platform configuration, probing, the lifespan Runtime manager, a
   dedicated Runtime owner task, request admission barrier, and clean
   health/Data Root APIs.
2. Replace the frontend connection gate with the bootstrap state machine and
   reuse its mutation path in Settings.
3. Remove Tauri Data Root persistence, IPC, validation, restart, and rollback;
   retain process supervision and the native picker plugin.
4. Regenerate OpenAPI/client code and align architecture, reference, setup,
   deployment, and desktop release documentation.
5. Run backend, frontend, Rust, documentation, and repository checks. Complete
   signed/notarized packaged macOS acceptance on release artifacts.
