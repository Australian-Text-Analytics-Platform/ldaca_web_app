---
status: accepted
---

# Arrow IPC for tabular HTTP data

Wordflow uses JSON for resource control and Arrow IPC streams for tabular HTTP
data. Complete immutable Result tables are fetched from one semantic URL;
open-ended tables expose independent zero-row schema and row-page streams.
Pages use one-row lookahead and `X-Wordflow-Has-Next` rather than total-count
queries.

This boundary preserves Arrow-native scalar, nested, and extension metadata,
avoids row-wise JSON conversion, and gives the frontend one table decoder.
Parquet remains the internal durable Data Block and Artifact format where it is
appropriate; persistence format and wire format are separate concerns.

The API does not offer protobuf table envelopes, JSON table fallbacks, or a
second Parquet-over-HTTP table representation. Semantic custom values use
stable Arrow extension names over documented storage types; an unregistered
client can still read the physical storage value.

The frontend uses the official `apache-arrow` JavaScript implementation. Topic
Distribution uses extension name
`org.ldaca.wordflow.topic_distribution.v1` over
`fixed-size-list[N+1]<struct<topic_id: int64, proportion: float64>>`, where the
entries are outlier `-1` followed by real topics `0..N-1`. Fixed-size storage
matches the domain invariant and avoids a variable-offset list encoding that
the supported Apache Arrow JavaScript release cannot decode. Frontend code
dispatches semantic rendering from the extension name and does not redefine
the storage type.
