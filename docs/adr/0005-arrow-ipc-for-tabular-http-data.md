---
status: accepted
---

# Arrow IPC for tabular HTTP data

Wordflow uses JSON for resource control and Arrow IPC streams for tabular HTTP
data. Complete immutable Result tables are fetched from one semantic URL;
open-ended tables expose independent zero-row schema and row-page streams.
Pages use one-row lookahead and `X-Wordflow-Has-Next` rather than total-count
queries.

Workspace SQL query mode is another open-ended table boundary: each request
wraps and collects one requested page as a complete IPC stream. Page changes
issue new requests rather than seeking within or retaining an Arrow stream.

This boundary preserves Arrow-native scalar, nested, and extension metadata,
avoids row-wise JSON conversion, and gives the frontend one table decoder.
Parquet remains the internal durable Data Block and Artifact format where it is
appropriate; persistence format and wire format are separate concerns.

Extension identity nevertheless remains one end-to-end schema contract. The
backend configures Polars before import to retain any unregistered Arrow
extension as a generic extension, and producers write the real extension dtype
rather than only its physical storage. Parquet and serialized lazy plans then
preserve the exact extension name, storage type, and metadata through Workspace
SQL and IPC. A parallel JSON custom-type registry was rejected because it would
duplicate the schema and diverge from plan-only Undo/Redo.

The API does not offer protobuf table envelopes, JSON table fallbacks, or a
second Parquet-over-HTTP table representation. Semantic custom values use
stable Arrow extension names over documented storage types; an unregistered
client can still read the physical storage value.

The backend writes native Polars Arrow IPC without downgrading its compatibility
level or rewriting valid Arrow storage types for a particular client. The
frontend uses the official `apache-arrow` JavaScript implementation and carries
each decoded `Field` through schema, selector, table, and preprocessing flows.
It does not translate fields into a parallel registry of Wordflow column-kind
names. UI type labels are the exact `ARROW:extension:name` metadata value when
present, otherwise Apache Arrow's native type spelling. Feature compatibility
is tested directly against decoded fields. Known extensions may select
specialized renderers by exact extension identity. Unknown foreign extensions
retain their exact name and metadata while using their decoded storage values;
they are not mislabeled as an unknown physical type. A type that the decoder
cannot decode fails that table request clearly; there is no JSON fallback,
backend type profile, or alternate decoder.

Topic Distribution uses extension name
`org.ldaca.wordflow.topic_distribution.v1` over
`fixed-size-list[N+1]<struct<topic_id: int64, proportion: float64>>`, where the
entries are outlier `-1` followed by real topics `0..N-1`. Fixed-size storage
expresses that domain invariant; it is not a client-compatibility workaround.
Frontend code dispatches semantic rendering from the extension name and does
not redefine the storage type or substitute a second display name.
