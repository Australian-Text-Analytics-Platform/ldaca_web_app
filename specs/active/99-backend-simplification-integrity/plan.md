# Implementation Plan

1. Record the baseline and remove only proven dead or duplicate paths.
2. Deepen storage, scheduling, process, snapshot, Topic projection, and
   provider modules without changing public behavior.
3. Replace generic worker dispatch and test-only input modes with typed,
   picklable inputs and focused preparation modules.
4. Upgrade direct dependencies and Python 3.14/FastAPI conventions in isolated
   dependency families.
5. Land one schema/API cutover for UUIDs, Tabs, Results, unavailable children,
   import records, and remote Quotation; regenerate and migrate the frontend in
   the same increment.
6. Complete publication, validation, corruption-isolation, and startup
   reconciliation boundaries with fault-injection and restart tests.
7. Update durable documentation and run the complete repository and packaged
   runtime proof set.
