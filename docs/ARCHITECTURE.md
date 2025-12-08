# LDaCA Web App Architecture

<!-- markdownlint-disable MD024 MD031 MD032 MD040 -->

## Overview

The LDaCA (Language Data Commons of Australia) Web Application is a full-stack text analytics platform consisting of three main components: **DocWorkspace** (graph-based data management), **Backend** (FastAPI REST API), and **Frontend** (React + TypeScript). The system enables interactive text analysis with workspace management, lazy evaluation, and visual data lineage tracking.

## Design Philosophy

### Core Principles

1. **Workspace-Based Analysis**: Data transformations tracked as nodes in a directed graph, enabling lineage tracking and reproducibility
2. **Lazy-by-Default**: Uses Polars LazyFrames to optimize performance by deferring execution until materialization
3. **Multi-User Support**: Optional Google OAuth with per-user data isolation, or single-user mode for local/Jupyter environments
4. **API-First**: Backend serves as thin adapter over DocWorkspace; frontend consumes pure JSON (no server-side rendering)
5. **Type Safety**: TypeScript frontend, Pydantic models in backend, strict type checking throughout

### Stack Summary

- **Backend**: Python 3.12+, FastAPI, async SQLite (aiosqlite), SQLAlchemy, DocFrame, DocWorkspace
- **Frontend**: React 19, TypeScript, TanStack Query v5, XYFlow (React Flow), Zustand, Vite
- **Data Layer**: Polars (eager/lazy DataFrames), DocFrame (document-aware extensions)
- **Workspace**: DocWorkspace (graph-based node management with parent-child relationships)

## Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                           │
│  - TanStack Query (API state management)                          │
│  - XYFlow (workspace graph visualization)                         │
│  - Zustand (UI state: selections, panel visibility)               │
│  - Axios (HTTP client)                                            │
└────────────────────────────────────────────────────────────────────┘
                               │
                               │ HTTP/JSON (REST API)
                               ├──────────────────────────────────┐
                               │                                  │
┌──────────────────────────────▼────────┐  ┌──────────────────────▼──────┐
│      Backend (FastAPI)                │  │    Authentication           │
│  - Routers (workspaces, files, text) │  │  - Google OAuth (optional)  │
│  - DocWorkspaceAPIUtils (adapters)   │  │  - JWT tokens               │
│  - WorkspaceManager (persistence)    │  │  - Single-user mode         │
│  - User data folder management       │  │  - Session management       │
└──────────────────────────────────┬────┘  └─────────────────────────────┘
                                   │
                        ┌──────────┴───────────┐
                        │                      │
           ┌────────────▼──────────┐  ┌────────▼──────────────┐
           │   DocWorkspace        │  │   DocFrame            │
           │  - Workspace (graph)  │  │  - DocDataFrame       │
           │  - Node (wrapper)     │  │  - DocLazyFrame       │
           │  - Relationships      │  │  - Text namespace     │
           │  - Serialization      │  │  - Text utilities     │
           └───────────────────────┘  └───────────────────────┘
                        │                      │
                        └──────────┬───────────┘
                                   │
                       ┌───────────▼────────────┐
                       │   Polars Backend       │
                       │  - DataFrame (eager)   │
                       │  - LazyFrame (lazy)    │
                       │  - Expression API      │
                       │  - I/O functions       │
                       └────────────────────────┘
                                   │
                   ┌───────────────┴────────────────┐
                   │                                │
      ┌────────────▼──────────┐     ┌──────────────▼─────────────┐
      │  User Data Storage    │     │  Database (SQLite)         │
      │  - workspaces/        │     │  - users table             │
      │  - uploads/           │     │  - auth sessions           │
      │  - exports/           │     │  - workspace metadata      │
      │  - cache/             │     │  - async access (aiosqlite)│
      └───────────────────────┘     └────────────────────────────┘
```

## Component Breakdown

### 1. DocWorkspace (`docworkspace/`)

**Purpose**: Graph-based data management library tracking DataFrame transformations as nodes with parent-child relationships.

#### Core Classes

##### `Node` (`node/core.py`)

**Purpose**: Wraps DataFrames/LazyFrames with relationship tracking and transparent method delegation.

**Key Features**:
- **Data Wrapping**: Supports pl.DataFrame, pl.LazyFrame, DocDataFrame, DocLazyFrame
- **Transparent Operations**: All DataFrame methods work directly (`node.filter()`, `node.select()`, etc.)
- **Automatic Relationship Tracking**: Operations create child nodes and link parents
- **Lazy Preservation**: Maintains laziness for performance optimization
- **Metadata Storage**: Tracks operation descriptions, custom metadata

**Implementation**:
- Uses `__getattr__` delegation to forward method calls to underlying data
- Wraps results in new Node instances to maintain graph structure
- Stores parent/child references as lists (`parents: List[Node]`, `children: List[Node]`)
- Generates UUIDs for unique node identification

**Key Methods**:
- `filter(condition)`: Filters data, creates child node with parent relationship
  - **Implementation**: Calls `data.filter(condition)`, wraps in new Node, links parent
- `select(columns)`: Selects columns, creates child node
  - **Implementation**: Delegates to `data.select()`, preserves lazy if applicable
- `join(other_node, on, how)`: Joins with another node, creates child with TWO parents
  - **Implementation**: Extracts data from both nodes, calls `data.join()`, links both as parents
- `collect()`: Materializes lazy frame to eager frame
  - **Implementation**: Calls `data.collect()`, wraps in new Node, marks as non-lazy
- `info()`: Returns node metadata (id, name, dtype, shape, schema, parents, children)
  - **Implementation**: Extracts schema using `data.schema` (Polars) or `data.collect_schema()` (LazyFrame)

**Example**:
```python
from docworkspace import Node, Workspace
import polars as pl

workspace = Workspace("analysis")
df = pl.DataFrame({"text": ["Hello", "World"], "score": [0.8, 0.9]})

# Create node (auto-adds to workspace)
node1 = Node(df, "raw_data", workspace)

# Operations create child nodes with relationships
node2 = node1.filter(pl.col("score") > 0.85)  # node2.parents = [node1]
node3 = node2.select(["text"])  # node3.parents = [node2]

# Check relationships
print(f"node1 children: {len(node1.children)}")  # 1 (node2)
print(f"node3 parents: {node3.parents[0].name}")  # "raw_data" (via node2)
```

##### `Workspace` (`workspace/core.py`)

**Purpose**: Container managing collection of nodes and providing graph operations.

**Key Features**:
- **Node Management**: Add, remove, retrieve nodes by ID or name
- **Graph Operations**: Find roots, leaves, descendants, ancestors
- **Serialization**: Save/load entire workspace with relationships
- **Metadata**: Store workspace-level metadata (timestamps, descriptions)

**Implementation**:
- Stores nodes in dict: `nodes: Dict[str, Node]` (key = node.id)
- Maintains workspace metadata: `_metadata: Dict[str, Any]`
- Assigns unique ID on creation: `self.id = str(uuid.uuid4())`

**Key Methods**:
- `add_node(node)`: Adds node and recursively adds all children
  - **Implementation**: Checks if node belongs to another workspace, moves it, recursively moves children
  - **Pattern**: Ensures graph consistency by moving entire subtree
- `get_root_nodes()`: Returns nodes with no parents
  - **Implementation**: Filters `[n for n in nodes.values() if not n.parents]`
- `get_leaf_nodes()`: Returns nodes with no children
  - **Implementation**: Filters `[n for n in nodes.values() if not n.children]`
- `get_descendants(node_id, include_self=True)`: Returns all descendants recursively
  - **Implementation**: BFS/DFS traversal starting from node, follows child edges
- `to_api_graph(layout_algorithm='grid')`: Converts to React Flow format
  - **Implementation**: Delegates to `DocWorkspaceAPIUtils.workspace_to_react_flow()`
  - **Returns**: `{nodes: [...], edges: [...], workspace_info: {...}}`

**Example**:
```python
workspace = Workspace("my_analysis")

# Add nodes
workspace.add_node(Node(df1, "data1"))
workspace.add_node(Node(df2, "data2"))

# Graph operations
roots = workspace.get_root_nodes()  # Nodes without parents
leaves = workspace.get_leaf_nodes()  # Nodes without children

# Serialization
workspace.serialize("workspace.json")
restored = Workspace.deserialize("workspace.json")
```

#### Serialization (`workspace/io.py`)

**Purpose**: Save/load workspaces with all nodes and relationships.

**Implementation**:
- `serialize_workspace(workspace)`: Converts to nested dict structure
  - **Process**: (1) Serialize each node → dict with data + metadata, (2) Store parent IDs in metadata, (3) Wrap in workspace envelope
  - **Format**: `{"workspace_metadata": {...}, "nodes": [{node_metadata, data_metadata, serialized_data}, ...]}`
- `deserialize_workspace(data)`: Reconstructs workspace from dict
  - **Process**: (1) Create workspace, (2) Deserialize nodes, (3) Rebuild parent-child relationships from stored IDs
  - **Validation**: Ensures all parent IDs reference existing nodes

**Key Insight**: Parent-child relationships stored as node IDs, reconstructed after all nodes loaded.

### 2. Backend (`backend/src/ldaca_web_app_backend/`)

**Purpose**: FastAPI REST API providing authenticated access to workspaces, files, and text analysis.

#### Project Structure

```
backend/
  api/                      # Router modules
    __init__.py
    auth.py                 # Authentication (Google OAuth / single-user)
    files.py                # File upload/download/list
    feedback.py             # User feedback collection
    users.py                # User management/storage info
    text.py                 # Text statistics endpoint
    admin.py                # Admin operations (clear analyses, tasks)
    workspaces/             # Workspace operations (modular)
      __init__.py
      base.py               # Base workspace CRUD
      nodes.py              # Node operations
      files.py              # Workspace-scoped file operations
      lifecycle.py          # Workspace lifecycle (load/unload)
      tasks.py              # Background task management
      utils.py              # Workspace utilities
      dependencies.py       # FastAPI dependencies
      analyses/             # Analysis modules
        __init__.py
        concordance.py      # Concordance analysis
        frequency_analysis.py  # Token frequency analysis
        token_frequencies.py   # Token frequency comparisons
        topic_modeling.py   # BERTopic topic modeling
        quotation.py        # Quotation extraction
  core/                     # Core logic
    api_models.py           # Pydantic models for API
    docworkspace_api.py     # DocWorkspace → JSON adapters
    workspace.py            # WorkspaceManager (in-memory orchestration)
    task_manager.py         # Async task manager (legacy)
    process_task_manager.py # Process-based task manager (current)
    worker.py               # ProcessPoolExecutor worker functions
    analysis_store.py       # In-memory analysis persistence
    analysis_admin.py       # Analysis administration utilities
    auth.py                 # Authentication helpers
    utils.py                # General utilities
    json_utils.py           # JSON sanitization utilities
    tasks.py                # Task utilities
  configs/                  # Configuration
  models/                   # Database models (users, sessions)
  settings.py               # Pydantic settings (env vars)
  db.py                     # Database session management
  main.py                   # FastAPI app entrypoint
  cli.py                    # CLI commands
  deploy.py                 # Deployment helpers
  entrypoints/              # Application entrypoints
  sample_data/              # Sample datasets
```

#### Key Components

##### FastAPI App (`main.py`)

**Purpose**: Application entrypoint with router registration and middleware.

**Implementation**:
- Creates `FastAPI()` instance with CORS middleware
- Registers routers: `app.include_router(auth.router, prefix="/api/auth")`
- Configures CORS: `CORSMiddleware` with allowed origins from settings
- Mounts static files (optional): Frontend build artifacts

**CORS Configuration**:
- Reads `CORS_ALLOWED_ORIGINS_STR` from env (comma-separated)
- Allows credentials for cookie-based auth
- Exposes all headers to frontend

##### Authentication Router (`api/auth.py`)

**Purpose**: Handle Google OAuth or single-user authentication.

**Key Endpoints**:
- `GET /api/auth/`: Returns auth info (multi-user mode, login required)
  - **Implementation**: Checks `settings.MULTI_USER`, returns config to frontend
- `POST /api/auth/google`: Google OAuth token exchange
  - **Implementation**: Validates Google token using `google.oauth2.id_token.verify_oauth2_token()`, creates/updates user in DB, returns JWT
- `GET /api/auth/me`: Get current user info
  - **Implementation**: Depends on `get_current_user()`, returns user object
- `POST /api/auth/logout`: Logout user
  - **Implementation**: Clears session (implementation varies by auth strategy)

**Authentication Flow** (Multi-User):
```
Frontend → Google OAuth → Authorization Code
    ↓
POST /api/auth/google with {credential: token}
    ↓
Backend validates with Google APIs
    ↓
Create/update User in database
    ↓
Generate JWT token
    ↓
Return {access_token, user_info} to frontend
    ↓
Frontend stores token, includes in Authorization header
```

**Single-User Mode**:
- `settings.MULTI_USER = False`
- `get_current_user()` returns fixed user from `SINGLE_USER_*` env vars
- No OAuth, no token validation

##### Workspace Router (`api/workspaces/base.py`, `nodes.py`, `analysis.py`)

**Purpose**: CRUD operations for workspaces and nodes, plus text analysis.

**base.py** - Workspace Management:
- `POST /api/workspaces`: Create workspace
  - **Implementation**: Creates `Workspace(name)`, persists via `WorkspaceManager.persist()`
- `GET /api/workspaces`: List user's workspaces
  - **Implementation**: Scans user's workspace folder, loads metadata files
- `GET /api/workspaces/{workspace_id}`: Get workspace details
  - **Implementation**: Loads workspace, calls `workspace_to_react_flow()`, returns graph JSON
- `DELETE /api/workspaces/{workspace_id}`: Delete workspace
  - **Implementation**: Removes workspace folder and metadata file

**nodes.py** - Node Operations:
- `POST /api/workspaces/{workspace_id}/nodes/load`: Load file as node
  - **Implementation**: Reads file using `docframe.read_csv/read_parquet()`, creates Node, adds to workspace
- `POST /api/workspaces/{workspace_id}/nodes/{node_id}/filter`: Filter node
  - **Implementation**: Parses Polars expression from JSON, calls `node.filter()`, returns new node info
- `POST /api/workspaces/{workspace_id}/nodes/{node_id}/compute-column/preview`: Preview a computed column expression
  - **Implementation**: Uses `core/expression_parser.build_polars_expression()` to translate the user string into a `pl.Expr`, evaluates against the node's lazy data with `with_columns`, limits to `preview_limit` rows, and returns data/dtypes without mutating the workspace
- `POST /api/workspaces/{workspace_id}/nodes/{node_id}/compute-column`: Persist a computed column directly on the node
  - **Implementation**: Reuses the safe expression parser, aliases the target column name, applies `with_columns` on the node's native data object (DocFrame, LazyFrame, or DataFrame), updates `node.data` in place, and calls `workspace_manager.persist()`; response includes the resolved column name, dtype, and expression echo
- `POST /api/workspaces/{workspace_id}/nodes/{node_id}/select`: Select columns
  - **Implementation**: Calls `node.select(columns)`, returns new node info
- `GET /api/workspaces/{workspace_id}/nodes/{node_id}/data`: Get node data (paginated)
  - **Implementation**: Uses `DocWorkspaceAPIUtils.get_paginated_data()`, materializes if lazy

**analysis.py** - Text Analysis:
- `POST /api/workspaces/{workspace_id}/analysis/token-frequencies`: Compute token frequencies
  - **Implementation**: Calls `compute_token_frequencies()` from docframe, stores result, returns analysis ID
- `POST /api/workspaces/{workspace_id}/analysis/concordance`: Extract concordances
  - **Implementation**: Calls `node.data.select(pl.col(column).text.concordance(...))`, returns results
- `POST /api/workspaces/{workspace_id}/analysis/topic-modeling`: Run topic modeling
  - **Implementation**: Creates background task, runs BERTopic, returns task ID

**Key Insight**: Routers are thin adapters - they parse JSON, call DocWorkspace/DocFrame methods, serialize responses.

##### DocWorkspaceAPIUtils (`core/docworkspace_api.py`)

**Purpose**: Adapter between DocWorkspace (Python objects) and FastAPI (JSON).

**Key Methods**:

- `convert_node_info_for_api(node)`: Converts node.info() to JSON-safe format
  - **Implementation**: Gets raw `node.info()`, converts schema to JS types, stringifies dtype
  - **Type conversion**: `pl.Int64` → `"Int64"`, `pl.Utf8` → `"String"`, etc.
  
- `workspace_to_react_flow(workspace, layout_algorithm='grid')`: Converts workspace to React Flow format
  - **Implementation**:
    1. Iterate nodes, calculate positions using `_calculate_layout()`
    2. Create `ReactFlowNode` for each with position, data (label, type, shape, columns)
    3. Iterate parent relationships, create `ReactFlowEdge` for each (source=parent.id, target=node.id)
    4. Return `WorkspaceGraph(nodes, edges, workspace_info)`
  - **Layout algorithms**: grid (rows/columns), vertical (top-down), horizontal (left-right), circular
  
- `node_to_summary(node)`: Creates NodeSummary for API responses
  - **Implementation**: Extracts id, name, dtype, shape, columns, schema
  - **Handles lazy**: For lazy frames, uses `collect_schema()` to avoid materialization
  
- `get_paginated_data(node, page=1, page_size=100)`: Paginates node data
  - **Implementation**:
    1. Materialize if lazy: `node.collect()` if needed
    2. Calculate slice: `start = (page-1) * page_size`, `end = start + page_size`
    3. Slice data: `data[start:end]`
    4. Convert to records: `data.to_dicts()`
    5. Return `PaginatedData(data, total_rows, page, page_size, total_pages)`

**Type Conversion Pattern**:
```python
def polars_type_to_js_type(polars_type: pl.DataType) -> str:
    """Polars → JavaScript type mapping for frontend consumption."""
    if isinstance(polars_type, pl.Int64): return "Int64"
    elif isinstance(polars_type, pl.Float64): return "Float64"
    elif isinstance(polars_type, pl.Utf8): return "String"
    elif isinstance(polars_type, pl.Boolean): return "Boolean"
    # ... more mappings
```

##### WorkspaceManager (`core/workspace_manager.py`)

**Purpose**: Manage workspace persistence (save/load from user folders).

**Implementation**:
- Stores workspaces in `{USER_DATA_FOLDER}/users/{user_id}/workspaces/{workspace_id}/`
- Each workspace folder contains:
  - `workspace.json`: Serialized workspace (nodes + relationships)
  - `metadata.json`: Workspace metadata (name, created_at, modified_at)
  - `nodes/`: Individual node data files (if needed for large datasets)

**Key Methods**:
- `persist(user_id, workspace_id, workspace)`: Saves workspace to disk
  - **Implementation**: Serializes workspace, writes JSON files, updates metadata timestamps
- `load(user_id, workspace_id)`: Loads workspace from disk
  - **Implementation**: Reads JSON files, deserializes workspace, validates integrity
- `list_workspaces(user_id)`: Lists user's workspaces
  - **Implementation**: Scans workspace folder, reads metadata files

**Key Insight**: Workspaces fully serialized - can be moved, backed up, or shared as JSON files.

#### Background Task System

**Purpose**: Execute long-running operations (topic modeling, large concordance searches) asynchronously without blocking API responses.

> **Note**: The original thread/async-based `TaskManager` module was removed. All long-running work now goes through the process-based manager described below, so the frontend documentation, SSE stream, and Zustand stores should only reference `ProcessTaskManager` events.

##### ProcessTaskManager (`core/process_task_manager.py`)

**Purpose**: Process-based task manager for CPU-intensive operations using ProcessPoolExecutor.

**Why Process-Based**:
- Avoids Python GIL (Global Interpreter Lock) for true parallelism
- Isolates Numba/BLAS threading issues (topic modeling uses different libraries)
- Prevents main process blocking on heavy computation

**Key Classes**:

- `TaskInfo`: Similar to async version but uses `concurrent.futures.Future` instead of `asyncio.Task`
  - **Additional**: `progress_message` field for detailed status updates
  - `update_status()`: Syncs TaskInfo with Future state

**Key Methods**:

- `subscribe(user_id, workspace_id)`: Creates event queue for real-time progress updates
  - **Implementation**: Creates `asyncio.Queue` for events, stores in `_subscribers` dict
  - **Use Case**: SSE (Server-Sent Events) streaming to frontend
  
- `unsubscribe(user_id, workspace_id, queue)`: Removes event queue
  
- `broadcast_event(user_id, workspace_id, event)`: Sends event to all subscribers
  - **Implementation**: Iterates subscriber queues, puts event (non-blocking)
  
- `submit_task(fn, *args, task_type, name, metadata)`: Submits function to ProcessPoolExecutor
  - **Implementation**:
    1. Get worker pool: `pool = get_worker_pool()`
    2. Submit to pool: `future = pool.submit(fn, *args, **kwargs)`
    3. Wrap in TaskInfo with metadata
    4. Start progress monitoring: `asyncio.create_task(_monitor_task(task_info))`
    5. Return TaskInfo
  - **Monitoring**: Background asyncio task polls future status, broadcasts progress events
  
- `_monitor_task(task_info)`: Internal coroutine monitoring process task
  - **Implementation**:
    1. While future not done: `await asyncio.sleep(0.5)`, check status
    2. Update TaskInfo status: calls `task_info.update_status()`
    3. Broadcast progress events to subscribers
    4. On completion: store result, broadcast final event
  
- `cancel_task(task_id)`: Attempts to cancel process task
  - **Limitation**: ProcessPoolExecutor doesn't support reliable cancellation; task continues
  
- `list()`, `any_running()`, `latest_by_type()`, `clear_tasks()`: Present the same API surface as the deprecated TaskManager so existing routers and tests did not need to change when the process-based backend landed.

**Example Usage**:
```python
tm = ProcessTaskManager()

# Submit CPU-intensive task to process pool
task_info = await tm.submit_task(
    topic_modeling_task,  # Function defined in worker.py
    user_id, workspace_id, node_ids, node_columns,
    min_topic_size=5,
    task_type="topic_modeling",
    name="Topic Modeling Analysis",
    metadata={"node_count": len(node_ids)}
)

# Subscribe to progress updates
queue = await tm.subscribe(user_id, workspace_id)
async for event in queue:
    # Event structure: {"type": "progress", "task_id": "...", "progress": 0.5, "message": "..."}
    yield event
```

##### Workspace Task Stream (SSE)

**Endpoint**: `GET /api/workspaces/{workspace_id}/tasks/stream`

1. When a user opens a workspace, the frontend mounts `useWorkspaceTaskStream(workspaceId)`. The hook now lives at `src/hooks/useWorkspaceTaskStream.ts` but simply re-exports the feature-scoped task inbox (`src/features/workspace/task-stream`).
2. `useWorkspaceTaskStreamClient` is the low-level SSE client. It attaches auth headers, maintains the connection/retry state (`status`, `error`, `reconnectAttempt`, `lastEventTimestamp`), and parses raw frames into JSON payloads.
3. `useWorkspaceTaskInbox` composes the client with the analysis store. It receives every parsed payload, runs the immutable `mergeTaskUpdates` helper, raises topic-model readiness flags, and surfaces any task-level error messages back through the legacy hook’s state so the Sidebar UI can continue to show the retry button.
4. Feature code that needs the raw client (e.g., future React Query adapters) can import it directly from `src/features/workspace/task-stream`, while existing consumers keep calling `useWorkspaceTaskStream` without seeing the refactor.

```tsx
const taskStream = useWorkspaceTaskStream(currentWorkspaceId);

// Under the hood: low-level SSE client plus inbox adapter
useWorkspaceTaskStreamClient(currentWorkspaceId, {
  getAuthHeaders,
  onEvent: (payload) => {
    if (payload.type === 'tasks_snapshot') {
      setTasks((prev) => mergeTaskUpdates(prev, payload.tasks.map((task) => ({ task })), { replaceAll: true }));
      return;
    }

    if (payload.type === 'task_changed') {
      setTasks((prev) =>
        mergeTaskUpdates(prev, [
          {
            task: payload.task,
            resultPersistedOverride: payload.result_persisted,
          },
        ])
      );
    }
    if (payload.type === 'analysis_saved' && payload.task_type === 'topic_modeling') {
      markTopicModelingReady(payload.task_id!, payload.timestamp);
    }
  },
});
```

Because the SSE stream is authoritative, tabs no longer poll `/tasks` blindly. Instead, `useAnalysisTaskLifecycle` only polls result endpoints (e.g., `/concordance/current-result`) when it sees that an active task exists or when the SSE terminal event fires. This keeps the sidebar, tabs, and toast banners synchronized without relying on the deprecated TaskManager worker, and the new task-stream client makes it possible to plug those events directly into React Query cache updates in later iterations.

##### Worker Pool (`core/worker.py`)

**Purpose**: Provides ProcessPoolExecutor and defines worker functions for heavy tasks.

**Key Functions**:

- `get_worker_pool()`: Returns singleton ProcessPoolExecutor
  - **Configuration**: `max_workers=4` (configurable via env), spawn start method (macOS compatibility)
  - **Initialization**: Calls `_configure_worker_environment()` on each worker process
  
- `_configure_worker_environment()`: Sets up numeric library threading in worker processes
  - **Implementation**:
    1. Force safe defaults: `NUMBA_THREADING_LAYER=workqueue`, `*_NUM_THREADS=1`
    2. Test TBB availability: imports `tbb`, tests Numba compilation
    3. If TBB works: upgrade to `NUMBA_THREADING_LAYER=tbb` for better performance
    4. If TBB fails: stick with single-threaded workqueue
  - **Reason**: Prevents Numba threading conflicts that cause crashes in topic modeling
  
- `topic_modeling_task(user_id, workspace_id, node_ids, node_columns, min_topic_size, use_ctfidf, progress_callback)`: Worker function for topic modeling
  - **Implementation**:
    1. Load workspace and nodes (process has separate memory space)
    2. Concatenate documents from multiple nodes
    3. Run BERTopic: `model = BERTopic(min_topic_size=...)`, `model.fit_transform(docs)`
    4. Extract topics, keywords, document assignments
    5. Report progress via callback (if provided)
    6. Return results dict (serializable)
  - **Isolation**: Runs in separate process with independent Python interpreter

**Process Lifecycle**:
```
Main Process                Worker Process
────────────                ──────────────
submit_task()
  ↓
ProcessPoolExecutor.submit()  →  [Worker spawns]
  ↓                              ↓
TaskInfo created               _configure_worker_environment()
  ↓                              ↓
_monitor_task() loop           topic_modeling_task() runs
  ↓                              ↓
  ← progress updates ───────── (implicit via shared state)
  ↓                              ↓
Broadcast events               Complete, return result
  ↓                              ↓
future.result() available  ←   [Worker terminates/reused]
  ↓
Update TaskInfo.result
  ↓
Broadcast completion event
```

##### WorkspaceManager Integration (`core/workspace.py`)

**Purpose**: Provides per-workspace task manager instances.

**Key Methods**:

- `get_task_manager(user_id, workspace_id)`: Returns ProcessTaskManager for workspace
  - **Implementation**:
    1. Create key: `(user_id, workspace_id)`
    2. Check cache: `self._task_managers.get(key)`
    3. If not exists: Create `ProcessTaskManager()`, cache it
    4. Return task manager
  - **Singleton Pattern**: One task manager per workspace (reused across requests)
  
**Storage**:
- `_task_managers: Dict[tuple[str, str], ProcessTaskManager]`: In-memory cache of task managers
- **Lifecycle**: Task managers persist for lifetime of WorkspaceManager instance (app lifecycle)
- **Cleanup**: Not automatically cleaned up (could be improved with LRU cache)

##### Task Router (`api/workspaces/tasks.py`)

**Purpose**: API endpoints for task management.

**Key Endpoints**:

- `GET /{workspace_id}/tasks`: List all tasks for workspace
  - **Implementation**: Gets task manager, calls `tm.list()`, returns task list
  
- `GET /{workspace_id}/tasks/{task_id}`: Get specific task status
  - **Implementation**: Searches task list for matching ID
  
- `DELETE /{workspace_id}/tasks/{task_id}`: Cancel task
  - **Implementation**: Calls `tm.cancel_task(task_id)`
  - **Note**: May not stop process tasks immediately
  
- `DELETE /{workspace_id}/tasks`: Clear all tasks (or by type)
  - **Implementation**: Calls `tm.clear_tasks(task_type=None)`
  
- `GET /{workspace_id}/tasks/stream`: SSE stream for real-time updates
  - **Implementation**:
    1. Subscribe to events: `queue = await tm.subscribe(user_id, workspace_id)`
    2. Create SSE generator: `async def event_generator(): while True: event = await queue.get(); yield event`
    3. Return StreamingResponse with generator
  - **Frontend**: Consumes events via EventSource API

**Example SSE Stream**:
```typescript
// Frontend
const eventSource = new EventSource(`/api/workspaces/${workspaceId}/tasks/stream`);
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(`Task ${data.task_id}: ${data.progress * 100}% - ${data.message}`);
};
```

#### Current Request/Result Persistence System

**Purpose**: Preserve analysis state across page refreshes for better UX.

##### Analysis Store (`core/analysis_store.py`)

**Purpose**: In-memory persistence of analysis requests and results per workspace.

**Design Decisions**:
- **In-Memory Only**: Data lives in WorkspaceManager, NOT serialized with workspace files
- **Scoped to Workspace Session**: Cleared when workspace unloaded or process restarts
- **Per-Task Storage**: One record per analysis type (concordance, frequency_analysis, topic_modeling)

**Key Classes**:

- `AnalysisRecord`: Dataclass with `task, saved_at, request, result` fields
  - `to_dict()`: Serializes to stable JSON shape

**Key Functions**:

- `_get_bucket(user_id, workspace_id)`: Internal helper getting analysis state dict
  - **Implementation**: `workspace_manager.get_analysis_state(user_id, workspace_id)`
  - **Returns**: `Dict[str, Dict[str, Any]]` (task_name → record_dict)
  
- `save_analysis(user_id, workspace_id, task, request_dict, result_dict)`: Saves analysis
  - **Implementation**:
    1. Get workspace analysis bucket
    2. Sanitize data: `json_sanitize(request_dict)`, `json_sanitize(result_dict)` (handles numpy types)
    3. Create AnalysisRecord with current timestamp
    4. Store in bucket: `bucket[task] = record.to_dict()`
    5. Return record
  - **Overwrite Behavior**: Latest analysis replaces previous (per task type)
  
- `get_latest_analysis(user_id, workspace_id, task)`: Retrieves latest analysis of type
  - **Implementation**: Looks up `bucket.get(task)`, returns AnalysisRecord or None
  
- `clear_analyses(user_id, workspace_id, task=None)`: Clears analyses
  - **Implementation**: If task specified, removes that key; else clears entire bucket
  - **Returns**: Count of records removed

**Storage Architecture**:
```
WorkspaceManager._analysis_state = {
  (user_id, workspace_id): {
    "concordance": {
      "task": "concordance",
      "saved_at": "2024-...",
      "request": {"node_ids": [...], "search_term": "..."},
      "result": {"matches": [...], "count": 123}
    },
    "topic_modeling": {
      "task": "topic_modeling",
      "saved_at": "2024-...",
      "request": {...},
      "result": {...}
    }
  }
}
```

##### Current-Request/Current-Result Endpoints

**Pattern**: Each analysis type has two endpoints for state persistence:

- `GET /{workspace_id}/{analysis_type}/current-request`: Get last request parameters
- `GET /{workspace_id}/{analysis_type}/current-result`: Get last analysis result
- `POST /{workspace_id}/{analysis_type}/current-result`: Get result with filters/pagination

**Implementation Pattern** (using concordance as example):

**Concordance** (`api/workspaces/analyses/concordance.py`):

- `GET /concordance/current-request`:
  - **Implementation**:
    1. Call `get_latest_analysis(user_id, workspace_id, "concordance")`
    2. If not found, try `"multi_concordance"` (backward compat)
    3. Normalize saved request: `_normalize_saved_request(rec.request, rec.result)`
    4. Return `{"state": "successful", "data": normalized_request}`
  - **Purpose**: Frontend uses this to pre-fill search form on page load
  
- `GET /concordance/current-result`:
  - **Implementation**:
    1. Get latest analysis record
    2. Normalize request and result: `_normalize_saved_result(rec.result, normalized_request)`
    3. Return full result
  - **Purpose**: Frontend displays results without re-running analysis
  
- `POST /concordance/current-result`:
  - **Body**: `ConcordanceResultQuery` (filters, pagination, sort)
  - **Implementation**:
    1. Get latest analysis record
    2. Apply filters to stored results (in-memory filtering)
    3. Apply pagination: `results[page*page_size:(page+1)*page_size]`
    4. Return filtered subset
  - **Purpose**: Frontend can paginate/filter without backend re-computation

**Sequential Analysis** (`api/workspaces/analyses/sequential_analysis.py`):

- `GET /sequential-analysis/current-request`:
  - Returns the last sequential analysis parameters including node IDs, selected column, `column_type`, `frequency`, optional `numeric_origin`/`numeric_interval`, and grouping columns. The frontend hydrates the tab with this payload so numeric forms stay in sync with locked jobs.
  
- `GET /sequential-analysis/current-result`:
  - Returns the cached sequential analysis DataFrame (counts, formatted periods, min/max timestamps or numeric ranges) along with persisted chart metadata.
  
- `POST /sequential-analysis/current-result`:
  - **Body**: Chart metadata overrides (currently `chart_type`), plus optional summary snippets consumed by the UI.
  - Reads the stored result from `analysis_store`, applies metadata update, and re-saves so subsequent GET calls reflect the new chart selection.

**Topic Modeling** (`api/workspaces/analyses/topic_modeling.py`):

- `GET /topic-modeling/current-request`:
  - Returns last topic modeling parameters (node IDs, min_topic_size, use_ctfidf)
  
- `GET /topic-modeling/current-result`:
  - Returns last topic modeling results (topics, keywords, document-topic assignments)

**UX Flow**:
```
User runs concordance analysis
  ↓
POST /concordance → Result stored in analysis_store
  ↓
Frontend displays results
  ↓
User refreshes page
  ↓
Frontend: GET /concordance/current-request → Pre-fills search form
  ↓
Frontend: GET /concordance/current-result → Displays cached results
  ↓
User clicks "Next Page"
  ↓
Frontend: POST /concordance/current-result {page: 2} → Returns page 2 from cache
```

**Key Insight**: This pattern provides instant page restoration without database persistence or re-computation.

##### Analysis Administration (`core/analysis_admin.py`)

**Purpose**: Administrative utilities for managing analyses across workspaces.

**Key Functions**:

- `clear_workspace_analyses(user_id, workspace_id, task_type)`: Clears stored analyses
  - **Implementation**: Calls `analysis_store.clear_analyses()` and `tm.clear_tasks()`
  - **Use Case**: Admin endpoint to free memory
  
- `list_workspace_analyses(user_id, workspace_id)`: Lists all saved analyses
  - **Implementation**: Calls `analysis_store.list_analyses()`, returns records

**Admin Router** (`api/admin.py`):

- `DELETE /admin/workspaces/{workspace_id}/analyses`: Clear analyses
  - Calls `clear_workspace_analyses()`
- `GET /admin/workspaces/{workspace_id}/analyses`: List analyses
  - Calls `list_workspace_analyses()`

#### Database Layer (`db.py`, `models/`)

**Purpose**: User management, authentication sessions.

##### Implementation

- **Database**: async SQLite (`sqlite+aiosqlite://`) with SQLAlchemy
- **Models**: `User` (id, email, name, created_at), `Session` (token, user_id, expires_at)
- **Migrations**: Manual migration scripts in `migrate_db.py`

##### Example

```python
# db.py
async def get_async_session():
    async with async_session_maker() as session:
        yield session

# Usage in endpoint
@router.post("/...")
async def endpoint(db: AsyncSession = Depends(get_async_session)):
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
```

### Complete Backend File Reference

This section provides comprehensive documentation of every backend file and its key functions.

#### Core Modules (`core/`)

##### `workspace.py` - WorkspaceManager

**Purpose**: Single-workspace-per-user in-memory orchestration.

###### Class: WorkspaceManager

**Key Data Structures**:
- `_current: Dict[str, Dict[str, Any]]`: Currently loaded workspace per user `{user_id: {id, ws}}`
- `_task_managers: Dict[tuple[str, str], ProcessTaskManager]`: Task managers per workspace
- `_analysis_state: Dict[tuple[str, str], Dict[str, Dict]]`: Analysis records per workspace

**Key Methods**:
- `get_current_workspace_id(user_id)`: Returns ID of loaded workspace
- `get_current_workspace(user_id)`: Returns loaded Workspace object
- `set_current_workspace(user_id, workspace_id)`: Loads workspace (saves previous if any)
- `create_workspace(user_id, name, description, data, data_name)`: Creates new workspace
- `get_workspace(user_id, workspace_id)`: Gets workspace (loads if needed)
- `list_user_workspaces_summaries(user_id)`: Lists all workspaces with metadata
- `delete_workspace(user_id, workspace_id)`: Deletes workspace file
- `get_task_manager(user_id, workspace_id)`: Gets/creates ProcessTaskManager
- `unload_workspace(user_id, save=True)`: Unloads workspace from memory
- `add_node_to_workspace(...)`: Creates node in workspace
- `get_node_from_workspace(...)`: Retrieves node by ID
- `delete_node_from_workspace(...)`: Removes node
- `get_workspace_graph(user_id, workspace_id, layout_algorithm)`: Converts to React Flow format
- `get_analysis_state(user_id, workspace_id)`: Gets analysis bucket
- `drop_analysis_state(user_id, workspace_id)`: Clears analysis cache

**Private Helpers**:
- `_save(user_id, workspace_id, workspace)`: Serializes workspace to JSON
- `_load(user_id, workspace_id)`: Deserializes workspace from JSON
- `_replace_current(user_id, new_id, new_ws)`: Swaps loaded workspace
- `_get_current_entry(user_id)`: Gets current workspace tuple
- `_analysis_key(user_id, workspace_id)`: Creates analysis cache key
- `_ensure_analysis_state(...)`: Initializes analysis bucket

##### `docworkspace_api.py` - DocWorkspaceAPIUtils

**Purpose**: Converts DocWorkspace objects to JSON-safe API responses.

**Key Functions**:
- `convert_node_info_for_api(node)`: Node → NodeSummary dict
- `workspace_to_react_flow(workspace, layout_algorithm)`: Workspace → WorkspaceGraph
- `node_to_summary(node)`: Node → NodeSummary Pydantic model
- `get_paginated_data(node, page, page_size)`: Paginated node data
- `create_operation_result(success, message, data)`: Standard response wrapper
- `handle_api_error(e, operation)`: Exception → error response
- `_calculate_layout(nodes, algorithm)`: Calculates node positions for visualization
- `polars_type_to_js_type(polars_type)`: Type conversion for frontend

##### `process_task_manager.py` - ProcessTaskManager

**Purpose**: Process-based task manager for CPU-intensive operations.

**Key Methods** (documented in Background Task System section above).

**Additional Methods**:
- `get_task(task_id)`: Retrieves TaskInfo by ID
- `update_progress(task_id, progress, message)`: Updates task progress (for monitoring)
- `_poll_future_status(task_info)`: Polls Future for completion
- `_cleanup_old_tasks(max_age_seconds)`: Removes old completed tasks

##### `worker.py` - Worker Functions

**Purpose**: Defines functions executed in ProcessPoolExecutor workers.

**Key Functions**:
- `get_worker_pool()`: Returns singleton ProcessPoolExecutor
- `_configure_worker_environment()`: Sets up threading env vars
- `topic_modeling_task(...)`: Runs BERTopic analysis
  - **Steps**: Load workspace → Concatenate docs → BERTopic fit_transform → Extract topics → Return results
- `concordance_task(...)`: Runs concordance analysis
  - **Steps**: Load workspace → Run concordance on each node → Return results (DataFrames)
- `_load_workspace_and_nodes(user_id, workspace_id, node_ids)`: Helper to load data in worker process
- `_prepare_documents(nodes, node_columns)`: Concatenates documents from multiple nodes

##### `analysis_store.py` - Analysis Persistence

**Purpose**: In-memory analysis request/result storage.

**Functions** (documented in Current Request/Result Persistence section above):
- `save_analysis(...)`, `get_latest_analysis(...)`, `clear_analyses(...)`, `list_analyses(...)`

##### `analysis_admin.py` - Analysis Administration

**Purpose**: Admin utilities for managing analyses.

**Functions**:
- `clear_workspace_analyses(user_id, workspace_id, task_type)`: Clears analyses and tasks
- `list_workspace_analyses(user_id, workspace_id)`: Lists stored analyses

##### `api_models.py` - Pydantic Models

**Purpose**: API request/response schemas.

**Key Models**:
- `NodeSummary`: Node metadata (id, name, dtype, shape, schema, parents, children)
- `WorkspaceInfo`: Workspace metadata (id, name, total_nodes, root_nodes, leaf_nodes)
- `WorkspaceGraph`: React Flow graph (nodes, edges, workspace_info)
- `ReactFlowNode`: Node for React Flow (id, type, position, data)
- `ReactFlowEdge`: Edge for React Flow (id, source, target, type)
- `PaginatedData`: Paginated results (data, total_rows, page, page_size, total_pages)
- `OperationResult`: Standard response (success, message, data)

**Request Models**:
- `CreateWorkspaceRequest`: Workspace creation params
- `FilterNodeRequest`: Filter expression params
- `ConcordanceRequest`: Concordance search params
- `FrequencyAnalysisRequest`: Token frequency params
- `TopicModelingRequest`: Topic modeling params

##### `auth.py` - Authentication Helpers

**Purpose**: User authentication utilities.

**Functions**:
- `get_current_user_from_token(token)`: Validates JWT, returns user dict
- `create_access_token(user_id)`: Generates JWT token
- `verify_google_token(credential)`: Validates Google OAuth token
- `get_single_user()`: Returns fixed user for single-user mode

##### `utils.py` - General Utilities

**Purpose**: Helper functions used across backend.

**Functions**:
- `generate_workspace_id()`: Creates unique workspace ID (UUID)
- `get_user_data_folder(user_id)`: Returns Path to user's data folder
- `get_user_workspace_folder(user_id)`: Returns Path to user's workspace folder
- `get_user_uploads_folder(user_id)`: Returns Path to user's uploads folder
- `sanitize_filename(filename)`: Removes unsafe characters
- `get_file_info(filepath)`: Returns file metadata (size, modified_at, mime_type)
- `detect_file_type(filename)`: Maps extensions (.csv, .json, .parquet, .tsv, .zip,
  `.txt`, `.text`, `.md`, `.rst`, `.log`) to loader hints used during ingestion
- `load_data_file(path)`: Centralized loader that picks the appropriate Polars
  scan/read call or DocFrame helper. CSV/TSV/Parquet return LazyFrames by default,
  JSON stays eager, ZIP files route to `docframe.read_zip`, and plain-text uploads
  (`.txt`, `.text`, `.md`, `.rst`, `.log`) are wrapped via `docframe.read_text`
  so they enter the workspace as single-document DocDataFrames.

##### `json_utils.py` - JSON Sanitization

**Purpose**: Converts non-serializable objects to JSON-safe types.

**Functions**:
- `json_sanitize(obj)`: Recursively sanitizes object
  - **Handles**: numpy types (int64 → int, float64 → float), datetime → ISO string, Path → str
  - **Recursion**: Processes dicts, lists, tuples, sets

##### `tasks.py` - Task Utilities

**Purpose**: Task-related helper functions.

**Functions**:
- `create_task_response(task_info)`: Converts TaskInfo to API response
- `format_task_list(tasks)`: Formats task list for API

#### API Routers (`api/`)

##### `auth.py` - Authentication Router

**Endpoints**:
- `GET /api/auth/`: Get auth info (multi-user mode, login required)
- `POST /api/auth/google`: Google OAuth token exchange
- `GET /api/auth/me`: Get current user info
- `POST /api/auth/logout`: Logout user
- `GET /api/auth/status`: Health check

**Dependencies**:
- `get_current_user()`: FastAPI dependency for auth (used in all protected endpoints)

##### `files.py` - File Management Router

**Endpoints**:
- `GET /api/files`: List user's uploaded files
- `POST /api/files/upload`: Upload file
  - **Implementation**: Saves to `{USER_DATA_FOLDER}/uploads/{user_id}/{filename}`
- `DELETE /api/files/{filename}`: Delete file
- `GET /api/files/{filename}`: Download file
- `POST /api/files/import-sample-data`: Import sample datasets
- `GET /api/files/preview/{filename}`: Preview file (first 100 rows)
  - **Excel preview**: Delegates sheet discovery and reading to `docframe.excel_sheet_names()` and `docframe.read_excel(..., document_column=False)`. Those helpers merely ensure the `fastexcel` dependency is present and then defer to `polars.read_excel` without forcing a specific engine, so FastAPI no longer needs to reason about `calamine` vs. legacy engine names. The endpoint just forwards the requested sheet name, slices the resulting `pl.DataFrame`, and serializes the preview response.

##### `users.py` - User Management Router

**Endpoints**:
- `GET /api/users/me`: Get current user profile
- `GET /api/users/storage-info`: Get storage usage stats
  - **Implementation**: Scans user folder, calculates sizes
- `DELETE /api/users/me/data`: Delete all user data

##### `text.py` - Text Statistics Router

**Endpoints**:
- `POST /api/text/statistics`: Get text statistics for DataFrame
  - **Implementation**: Computes word count, char count, sentence count, unique tokens

##### `feedback.py` - Feedback Router

**Endpoints**:
- `POST /api/feedback/submit`: Submit user feedback
  - **Implementation**: Saves feedback to file in user's folder

##### `admin.py` - Admin Router

**Endpoints**:
- `DELETE /api/admin/workspaces/{workspace_id}/analyses`: Clear workspace analyses
- `GET /api/admin/workspaces/{workspace_id}/analyses`: List workspace analyses
- `POST /api/admin/clear-cache`: Clear application caches

#### Workspace Routers (`api/workspaces/`)

##### `base.py` - Base Workspace Operations

**Endpoints**:
- `POST /api/workspaces`: Create workspace
- `GET /api/workspaces`: List user's workspaces
- `GET /api/workspaces/current`: Get currently loaded workspace
- `PUT /api/workspaces/current`: Set current workspace
- `GET /api/workspaces/{workspace_id}`: Get workspace graph
- `PUT /api/workspaces/{workspace_id}`: Update workspace metadata
- `DELETE /api/workspaces/{workspace_id}`: Delete workspace
- `GET /api/workspaces/{workspace_id}/summary`: Get workspace summary

##### `nodes.py` - Node Operations

**Endpoints**:
- `POST /api/workspaces/{workspace_id}/nodes/load`: Load file as node
- `GET /api/workspaces/{workspace_id}/nodes`: List nodes
- `GET /api/workspaces/{workspace_id}/nodes/{node_id}`: Get node info
- `POST /api/workspaces/{workspace_id}/nodes/{node_id}/filter`: Filter node
- `POST /api/workspaces/{workspace_id}/nodes/{node_id}/compute-column/preview`: Preview a computed column expression
- `POST /api/workspaces/{workspace_id}/nodes/{node_id}/compute-column`: Persist a computed column on the node
- `POST /api/workspaces/{workspace_id}/nodes/{node_id}/select`: Select columns
- `POST /api/workspaces/{workspace_id}/nodes/{node_id}/join`: Join nodes
- `POST /api/workspaces/{workspace_id}/nodes/{node_id}/rename`: Rename node
- `DELETE /api/workspaces/{workspace_id}/nodes/{node_id}`: Delete node
- `GET /api/workspaces/{workspace_id}/nodes/{node_id}/data`: Get node data (paginated)
- `POST /api/workspaces/{workspace_id}/nodes/{node_id}/collect`: Materialize lazy node
- `GET /api/workspaces/{workspace_id}/nodes/{node_id}/describe`: Get column statistics

##### `files.py` - Workspace File Operations

**Endpoints**:
- `POST /api/workspaces/{workspace_id}/files/load`: Load file into workspace
- `POST /api/workspaces/{workspace_id}/files/export-node/{node_id}`: Export node to file

##### `lifecycle.py` - Workspace Lifecycle

**Endpoints**:
- `POST /api/workspaces/{workspace_id}/load`: Load workspace into memory
- `POST /api/workspaces/{workspace_id}/unload`: Unload workspace from memory
- `GET /api/workspaces/{workspace_id}/status`: Get workspace load status

##### `tasks.py` - Task Management

**Endpoints** (documented in Background Task System section above):
- `GET /{workspace_id}/tasks`, `GET /{workspace_id}/tasks/{task_id}`, `DELETE /{workspace_id}/tasks/{task_id}`, etc.

##### `dependencies.py` - FastAPI Dependencies

**Functions**:
- `get_task_manager(user_id, workspace_id)`: Dependency providing task manager
- `get_workspace(user_id, workspace_id)`: Dependency providing workspace
- `require_workspace_loaded(user_id, workspace_id)`: Ensures workspace loaded

##### `utils.py` - Workspace Utilities

**Functions**:
- `validate_node_exists(workspace, node_id)`: Checks node existence
- `parse_polars_expression(expr_str)`: Safely parses Polars expression
- `format_node_info(node)`: Formats node metadata

###### `core/expression_parser.py` – Computed Column Expressions

**Purpose**: Convert a curated subset of Python expressions into Polars `Expr` objects that the computed-column endpoints can execute safely.

**Highlights**:

- Supports arithmetic, boolean, chained comparisons, ternary expressions, and helper functions (`abs`, `round`, `sqrt`, `log`, `log10`, `exp`, `sin`, `cos`, `tan`, `floor`, `ceil`, `clip`, `min`, `max`, `coalesce`, `fill_null`, `when`, `lit`, `col`).
- Validates every identifier against the active node's schema. Bare names map to `pl.col(name)`; string literals that match a column name allow referencing columns with spaces (e.g. `"Total Count"`). Use `lit("value")` to force a literal string when the literal equals an existing column name.
- Rejects attribute access, unapproved functions, and unknown columns, raising `ExpressionParseError` so the API can return a 400 with a descriptive message instead of executing arbitrary Python.

**Example**:

```python
from ldaca_web_app_backend.core.expression_parser import build_polars_expression

expr = build_polars_expression('A + "Total Count"', columns={"A", "Total Count"})
result = lazy_frame.with_columns(expr.alias('A + Total Count'))
```

#### Analysis Routers (`api/workspaces/analyses/`)

##### `concordance.py` - Concordance Analysis

**Endpoints**:
- `POST /{workspace_id}/concordance`: Run concordance search
  - **Implementation**: Submits async task to `ProcessTaskManager`, returns task ID
- `GET /{workspace_id}/concordance/current-request`: Get last concordance request
- `GET /{workspace_id}/concordance/current-result`: Get last concordance result (paginated)
- `POST /{workspace_id}/concordance/current-result`: Get filtered/paginated concordance result
- `POST /{workspace_id}/concordance/clear`: Clear concordance results, cached frames, and associated task manager entries

The clear endpoint delegates to `clear_analyses_and_cache()` which removes the stored analysis payloads, prunes the shared concordance cache, **and calls `ProcessTaskManager.clear_tasks(task_type="concordance")`** for the current user/workspace. The JSON response includes

```json
{
  "state": "successful",
  "cleared": {
    "analyses_removed": <int>,
    "concordance_cache_removed": <int>,
    "tasks_removed": <int>
  }
}
```

allowing the frontend task sidebar to immediately drop any lingering concordance rows when the user clicks “Clear Results”.

**Helper Functions**:
- `_normalize_saved_request(request, result)`: Normalizes stored request for frontend
- `_normalize_saved_result(result, request)`: Normalizes stored result
- `_process_dataframe_result(result, request)`: Paginates task result DataFrames

##### `sequential_analysis.py` - Sequential Analysis

**Endpoints**:
- `POST /{workspace_id}/nodes/{node_id}/sequential-analysis`: Run sequential (time-series) analysis
  - **Implementation**:
    1. Load the node schema and infer the selected column type (`datetime`, `date`, `time`, `integer`, `float`). This powers the default `column_type` when the frontend does not explicitly set it.
    2. Validate the request body (`SequentialAnalysisRequest`):
       - `frequency`: literal union `'hourly' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'`
       - `column_type`: `'datetime'` or `'numeric'`
       - Numeric mode requires `numeric_interval > 0` (enforced by a Pydantic validator) and optional `numeric_origin` fallback to column minimum.
    3. Reject incompatible combinations early (e.g., numeric column with `column_type="datetime"`) so the UI receives a descriptive 400 before docframe is called.
    4. Call `selected_lazy_frame.text.sequential_analysis(...)` passing along newly supported hourly/quarterly frequencies or numeric bin parameters.
    5. Store `{request, result}` plus `chart_type` inside `analysis_store` under the per-user workspace key.
- `GET /{workspace_id}/sequential-analysis/current-request`: Get last request
- `GET /{workspace_id}/sequential-analysis/current-result`: Get last result
- `POST /{workspace_id}/sequential-analysis/current-result`: Persist chart metadata updates (e.g., chart_type)
- `DELETE /{workspace_id}/sequential-analysis`: Clear results

**Q:** How does the API respond if `column_type="numeric"` is sent without `numeric_interval`?

**A:** The request fails validation with `422 Unprocessable Entity` because the Pydantic model enforces `numeric_interval` to be a positive number. The frontend surfaces that message next to the interval input, preventing ambiguous `[start, end)` ranges.

##### `token_frequencies.py` - Token Frequency Comparisons

**Endpoints**:
- `POST /{workspace_id}/token-frequencies`: Compute token frequencies for multiple nodes
  - **Implementation**: Similar to frequency_analysis but for multi-node comparison
- `GET /{workspace_id}/token-frequencies/{analysis_id}`: Get specific analysis

##### `topic_modeling.py` - Topic Modeling

**Endpoints**:
- `POST /{workspace_id}/topic-modeling`: Run topic modeling (background task)
  - **Implementation**:
    1. Get task manager
    2. Submit `topic_modeling_task` to ProcessPoolExecutor
    3. Return task_id immediately
    4. Client polls task status or subscribes to SSE stream
- `GET /{workspace_id}/topic-modeling/current-request`: Get last request
- `GET /{workspace_id}/topic-modeling/current-result`: Get last result
- `POST /{workspace_id}/topic-modeling/clear`: Clear results and purge `topic_modeling` tasks from ProcessTaskManager

Like concordance, the clear endpoint returns a `cleared` summary with `analyses_removed` and `tasks_removed` counts so the frontend can synchronise its task list immediately after the user clears results.

**Helper Functions**:
- `_prepare_topic_modeling_params(request)`: Validates and prepares parameters
- `_format_topic_modeling_result(result)`: Formats BERTopic output for API

##### `quotation.py` - Quotation Extraction

**Endpoints**:

- `POST /{workspace_id}/quotation`: Extract quotations
  - **Implementation**: Materialises the target node into a Polars `DataFrame`, feeds it into `_compute_quote_dataframe()`, joins the exploded quotation rows back to the original metadata, and persists the response envelope to `analysis_store`. The local engine path delegates to DocFrame's `text.quotation()` and mirrors the legacy explode/unnest behaviour, while the remote engine path streams batches through `_extract_remote_paginated()` so that the external service limit defined by `settings.quotation_service_max_batch_size` is honoured before pagination.
- `GET /{workspace_id}/quotation/current-request`: Get last request
- `GET /{workspace_id}/quotation/current-result`: Get last result
- `POST /{workspace_id}/quotation/current-result`: Update cached display preferences (currently only `context_length`) without recomputing quotations. The handler merges `{ "preferences": { "context_length": <int> } }` into the stored result entry after clamping values to 2,000 words.
- `DELETE /{workspace_id}/quotation`: Clear results

Every quotation result payload now includes a `preferences` object. The backend stamps a `context_length` key (default `20`, minimum `0`, maximum `2_000`) during extraction, and the POST endpoint above lets the frontend adjust that value later. Because the preference is cached server-side, the quotation results tab can hydrate the previously selected context length exactly like the Token Frequency panel hydrates its token limit.

#### Other Backend Files

**`db.py` - Database Management**:

- `get_async_session()`: Async dependency providing SQLAlchemy session
- `init_db()`: Initialize database tables
- `get_engine()`: Returns async SQLAlchemy engine

**`settings.py` - Application Settings**:

- `Settings`: Pydantic settings class loading from env vars
- Key settings: `MULTI_USER`, `GOOGLE_CLIENT_ID`, `DATABASE_URL`, `USER_DATA_FOLDER`, `CORS_ALLOWED_ORIGINS_STR`, `quotation_service_timeout`, `quotation_service_max_batch_size`

**`main.py` - FastAPI Application**:

- Creates FastAPI app
- Registers all routers with appropriate prefixes
- Configures CORS middleware
- Startup/shutdown events for database initialization

**`cli.py` - CLI Commands**:

- `ldaca-backend serve`: Start server
- `ldaca-backend init-db`: Initialize database
- `ldaca-backend create-user`: Create user (CLI)

**`deploy.py` - Deployment Utilities**:
- Helper functions for deployment configuration
- Environment detection (development/production)

**`models/` - Database Models**:
- `User`: User model (id, email, name, created_at, google_id)
- `Session`: Authentication session model (token, user_id, expires_at)

### 3. Frontend (`frontend/src/`)

### 3. Frontend (`frontend/src/`)

**Purpose**: React + TypeScript UI for interactive text analysis and workspace visualization.

#### Project Structure

```
frontend/src/
  components/              # React components
    layout/                # App shell: Sidebar, WorkspaceGraphView, headers
      sidebar/             # SidebarNodesSection, SidebarTasksSection, helpers
    panels/                # Node detail drawers, inspectors
    analysis/              # TokenFrequency, Concordance, TopicModeling
    tabs/                  # Tab panels for different views
    ui/                    # Reusable UI components (buttons, dialogs)
  api/                     # API client
    client.ts              # Axios instance with auth interceptor
    workspaces.ts          # Workspace API calls
    nodes.ts               # Node API calls
    analysis.ts            # Analysis API calls
  hooks/                   # Custom React hooks
    useWorkspaceInternal.ts  # TanStack Query + Zustand orchestrator
    useWorkspaceData.ts      # WorkspaceProvider data slice (graph, nodes)
    useWorkspaceSelection.ts # Selection slice (selected ids + pagination helpers)
    useWorkspaceActions.ts   # Node mutations + toggle selection
    useWorkspaceTaskStream.ts# Thin wrapper over the feature-scoped task-stream client/inbox
    useAuth.ts               # Authentication state/actions
  stores/                  # Zustand stores
    selectionStore.ts      # Node/graph selection cache (single source of truth)
    workspaceStore.ts      # Legacy stub (WorkspaceProvider now owns workspace id + pagination)
    analysisStore.ts       # Task inbox populated by SSE
    uiStore.ts             # Shell/Sidebar state (active view, dialogs, loaders)
  providers/               # React context providers
    QueryProvider.tsx      # TanStack Query client setup
    AuthProvider.tsx       # Authentication context
  types/                   # TypeScript types
    index.ts               # Workspace, Node, Analysis types
    api.ts                 # API request/response types
  utils/                   # Utility functions
    api.ts                 # API URL construction
  App.tsx                  # Root component
  main.tsx                 # ReactDOM render
```

#### Key Components

##### WorkspaceGraphView (`components/layout/WorkspaceGraphView.tsx`)

**Purpose**: Present the workspace DAG with XYFlow while delegating all data fetching and selection state to `WorkspaceProvider` + Zustand stores. The component is intentionally “dumb”: it only consumes context slices and dispatches actions exposed by the provider.

**Data Flow**:
- `WorkspaceProvider` calls `useWorkspaceInternal()` once per workspace. That hook now composes three focused helpers—`useWorkspaceCore` (auth headers, workspace id, pagination, Zustand selectors), `useWorkspaceQueries` (all TanStack Query fetches), and `useWorkspaceNodeMutations` (workspace/node mutations)—plus a tiny text-task layer. The composed result still fans out through `useWorkspaceData()`, `useWorkspaceSelection()`, and `useWorkspaceActions()`, but each concern stays isolated and memoized. Workspace identity + table pagination now live inside `useWorkspaceCore`, so every consumer reads the same derived values without duplicating state.
- `WorkspaceGraphView` reads `{ workspaceGraph, currentWorkspaceId }` via `useWorkspaceData()` and never makes HTTP calls directly.
- Selection state lives in `selectionStore.ts`. The graph receives `selectedNodeIds` through `useWorkspaceSelection()` and dispatches `toggleNodeSelection` via `useWorkspaceActions()`, so React Flow simply reflects whatever the store decides is “selected”.

**Implementation Highlights**:
- Computes a Dagre layout client-side to keep the graph readable even though the backend already returns coordinates. This lets the UI recover gracefully if a saved layout is missing or corrupt.
- Registers a single `customNode` type that renders `CustomNode` (see `components/CustomNode.tsx`) for every workspace node, ensuring consistent badges/menus.
- Mirrors store selection back into React Flow by mutating local node state whenever `selectedNodeIds` changes, preventing the library from clearing the highlights when the user clicks an empty pane.

**Selection Handling**:
```tsx
const { workspaceGraph } = useWorkspaceData();
const { selectedNodeIds } = useWorkspaceSelection();
const { toggleNodeSelection } = useWorkspaceActions();

const onNodeClick: NodeMouseHandler = useCallback((event, node) => {
  event.preventDefault();
  event.stopPropagation();
  if (node?.id) {
    toggleNodeSelection(node.id); // writes into selectionStore
  }
}, [toggleNodeSelection]);

useEffect(() => {
  setNodes((nodes) => nodes.map((n) => ({
    ...n,
    selected: selectedNodeIds.includes(n.id),
    data: { ...n.data, isMultiSelected: selectedNodeIds.length > 1 && selectedNodeIds.includes(n.id) },
  })));
}, [selectedNodeIds]);
```

**Node Rendering**:
```tsx
const CustomNode = ({ data }) => (
  <div className="node">
    <div className="node-label">{data.label}</div>
    <div className="node-type">{data.nodeType}</div>
    <div className="node-shape">{data.shape && `${data.shape[0]}×${data.shape[1]}`}</div>
  </div>
);
```

Because the graph is no longer the “global selection source”, other surfaces—most notably the Sidebar—can read the same `selectionStore` slice and stay in sync without depending on React Flow internals.

##### Sidebar Shell (`components/layout/Sidebar.tsx` + `components/layout/sidebar/*`)

**Purpose**: Provide a tri-section sidebar (Views, Nodes, Tasks) that mirrors workspace selection, exposes navigation, and surfaces long-running analysis jobs. The component consumes WorkspaceProvider slices exactly like the graph, so the two stay synchronized without bespoke props.

**Key Pieces**:
- `SidebarNodesSection` receives `nodes`, `selectedNodeIds`, and `onToggleNodeSelection` props. Toggling a checkbox simply calls `useWorkspaceActions().toggleNodeSelection`, which writes into `selectionStore`. Hover cards fetch shapes lazily via `getNodeShape` (cached in `sessionStorage`) so the UI can show “rows × cols” without prefetching every node.
- `SidebarTasksSection` reads `tasks` from `analysisStore` (populated by the feature-scoped task inbox) and offers Cancel/Clear buttons that call the workspace task endpoints. Connection pills reflect the status returned by `useWorkspaceTaskStream` (the compatibility hook built on `useWorkspaceTaskInbox`), so the UI still shows `connecting`, `open`, and `error` states even though the underlying SSE client now lives in `src/features/workspace/task-stream`.
- The Views list reflects `useUIStore().currentView` so selecting “Token Frequency” or “Topic Modeling” updates the same store that the tab router consumes.

**Data/Task Wiring**:
```tsx
const { workspaceGraph, currentWorkspaceId, getNodeShape } = useWorkspaceData();
const { selectedNodeIds } = useWorkspaceSelection();
const { toggleNodeSelection } = useWorkspaceActions();
const { tasks, setTasks } = useAnalysisStore();
const taskStream = useWorkspaceTaskStream(currentWorkspaceId);

<SidebarNodesSection
  nodes={(workspaceGraph?.nodes ?? []) as SidebarWorkspaceNode[]}
  selectedNodeIds={selectedNodeIds}
  onToggleNodeSelection={toggleNodeSelection}
  getNodeShape={getNodeShape}
/>

<SidebarTasksSection
  tasks={tasks}
  onCancelTask={handleCancelTask}
  onClearTask={handleClearTask}
  connectionStatus={taskStream.status}
/>
```

The end result is a single source of truth for selection (Zustand) and a single source of truth for analysis jobs (`analysisStore`), with both the graph and sidebar acting as thin projections of that state.

##### TokenFrequencyFeature (`frontend/src/features/analysis/token-frequency/TokenFrequencyFeature.tsx`)

**Purpose**: Token frequency analysis with word clouds and statistics.

**Key Features**:
- Multi-node comparison (select multiple nodes in graph)
- Unified word cloud (combined frequencies across selected nodes)
- Per-node word clouds and tables
- Statistical measures (log-likelihood, Bayes factor, effect size)
- Stop-word filtering is applied entirely in the browser. The feature keeps the full backend payload intact, derives `nodeDisplayResults` via `useMemo`, and walks the unbounded token list to “backfill” slots so that each word cloud/table still renders up to the learner’s configured `token_limit` even after common words are filtered out.
- For UX/performance parity, the input is clamped to **100 tokens max**. Requests above that ceiling are automatically reset to 100 and the learner sees an alert explaining that word clouds can’t render larger payloads.

**Implementation**:
- Fetches token frequencies: `useMutation({mutationFn: (params) => api.computeTokenFrequencies(workspaceId, params)})`
- Backend now returns the full vocabulary; the feature enforces the user’s preferred `token_limit` locally before rendering the table or clouds.
- Generates word clouds using `react-wordcloud` library
- Displays statistics tables with sorting/filtering
- Locks analysis results (prevents re-computation on node selection changes)

**Walkthrough Q**: *How does the UI keep results manageable if the backend never truncates?*

**Answer**: Treat this feature like a teaching demo for lazy data handling:
1. Read `result.metadata.token_limit` (default 10) plus `metadata.server_limit` to learn the saved UI preference.
2. Slice the unbounded `data` array with `data.slice(0, token_limit)` when rendering each table/word cloud.
3. Surface `total_tokens_before_limit` and `total_tokens_returned` so students can see that `applied_server_limit` is always `null` unless a legacy record is loaded.
4. Persist the learner’s stop words via `/token-frequencies/current-request`, ensuring the UI filter stays in sync with the saved metadata without ever discarding raw frequencies.

**Locking Mechanism** (Bug Fixed):
```tsx
// Only use locked nodes for analysis, not currently selected nodes
const analysisNodeIds = useMemo(() => {
  if (lastCompareNodeIds.length > 0) {
    return lastCompareNodeIds;  // Use locked analysis
  }
  return [];  // No locked analysis yet
}, [lastCompareNodeIds]);  // NOT dependent on selectedNodes!

// normalized results ONLY include nodes from analysisNodeIds
const normalizedNodeResults = useMemo(() => {
  if (!results || !results.data) return [];
  return analysisNodeIds.map(nodeId => 
    results.data.find(r => r.node_id === nodeId) || {node_id: nodeId, frequencies: {}}
  ).slice(0, 2);  // Max 2 for binary comparison
}, [results, analysisNodeIds]);  // Only depends on locked IDs
```

**Key Insight**: Analysis results locked to prevent UI changes when selecting additional nodes in graph view.

#### Analysis Shared Utilities (`frontend/src/features/analysis/common/`)

The analysis tabs now share a small toolbox that keeps hydration, locking, and color assignment consistent across Token Frequency, Concordance, Sequential Analysis, and future modules. Consolidating these helpers fixes the "Failed to fetch dynamically imported module" regressions (imports such as `../common`) and keeps feature implementations slimmer.

- `utils.ts`
  - Exposes quantitative helpers used throughout Token Frequency (and planned for Sequential Analysis), including `clampDisplayTokenLimit`, `computeServerLimit`, `toFiniteNumber`, and a resilient `formatNumber` that handles suffixes, multipliers, and graceful fallbacks. All exports are pure functions so tabs can `import { formatNumber } from '../common'` without pulling in React.
- `useAnalysisHydration.ts`
  - Wraps the current-request/current-result persistence pattern. Tabs pass workspace-aware fetch/apply functions plus optional preference persistence callbacks. The hook handles focus/visibility rehydration, deduplicates network requests, and normalizes preference objects so each feature doesn’t have to reinvent the “hydrate on mount + rehydrate on refocus” dance.
- `useAnalysisLockMachine.ts`
  - Owns the lock-state machine outright (the heavy logic moved here from `useAnalysisLockState.ts`). The module exposes `useAnalysisLockCore` for legacy callers and layers snapshot helpers (`captureSnapshotsForNodes()`, `lockWithCurrentNodes()`) plus workspace-aware persistence on top. The public hook returns the full lock state plus these helpers, while `useAnalysisLockState` simply re-exports the core behavior for older tabs.
- `useNodeColorPalette.ts`
  - Centralizes deterministic node coloring. Given a set of node ids (and optional metadata), it guarantees each node receives a palette color, exposes setters for the color picker UI, surfaces a legend describing `{id, label, color}`, and even provides `getGradientForNodes()` for combined visualizations. Token Frequency already uses it to keep colors uniform between the selection panel, per-node charts, and the Concordance handoff payload.
- `useNodeColumnOptions.ts`
  - Normalizes schema metadata for every selected node and enforces any data-type filters required by the analysis surface. Consumers pass the selected nodes plus an optional `getNodeColumns` helper and the hook returns a map keyed by node id that includes filtered column lists, fallback flags, and "filtered out" indicators. The function is also exported in pure form (`buildNodeColumnOptionsMap`) so it can be unit tested without React, which keeps the new logic well covered.
- `components/NodeColorPicker.tsx`
  - Shared Radix-driven color dropdown that exposes the palette swatches, a native color input, and a hex text box. Any feature (or the selection list) can mount it without duplicating the dropdown plumbing, and the component keeps the inputs in sync so the palette, color input, and text box always reflect the current color.
- `components/NodeColumnSelector.tsx`
  - Reusable select control that handles the "Select column…" clear option, missing-column preservation, and friendly empty-state messages. Callers only provide the filtered column array and a change handler; the component renders the standard label, select trigger, and empty warning used throughout the analysis tabs.
- `components/NodeSelectionList.tsx`
  - Stateless renderer for the horizontal node cards used in Token Frequency, Concordance, Sequential Analysis, etc. It handles color badges, card layout, and optional render props for metadata + card body content, so legacy surfaces like `NodeSelectionPanel` can become thin wrappers that simply pass the appropriate render functions.

All of the above are re-exported through `common/index.ts`, so analysis tabs only need `import { useAnalysisLockMachine, useNodeColorPalette } from '../common';` to opt in.

##### FilterSubTab (`frontend/src/features/preprocessing/filter/FilterSubTab.tsx`)

**Purpose**: Feature-sliced implementation of the preprocessing “Filter” sub-tab. The component now lives alongside the shared preview utilities so it can import hooks, serializers, and helpers without deep `../../components/...` paths.

**Key Dependencies**:
- `usePreprocessingPreview` — debounced preview hook shared across preprocessing subtabs (filter, slice, concat). The filter tab passes `{ nodeId, payload }` plus pagination arguments and receives `{ data, columns, pagination, setPage, setPageSize }`.
- Shared UI primitives from `components/ui` (Button, Select, Card, Tag) and the `NodeSelectionPanel` so that filter configuration mirrors the other subtabs.
- Serializer helpers in `frontend/src/features/preprocessing/filter/utils/serializers.ts` to build request payloads and validate condition completeness before hitting the API.
- Type helpers (`normalizeTypeName`, `getOperatorsForType`, `formatPreviewValue`) to keep column datatype detection and categorical label formatting consistent with other preprocessing steps.

**Implementation Highlights**:
1. **Schema-aware column list** – `availableColumns` normalizes `nodeData.dtypes`, or falls back to the node schema if the API has not returned dtype metadata yet. Each condition persists the resolved `dataType` so operator dropdowns and value inputs stay in sync even as columns change.
2. **Categorical option cache** – `ensureCategoricalOptions(column)` calls `nodesApi.uniqueValues` once per `(workspace, node, column)` and stores the result in local state keyed by `${workspaceId}::${nodeId}::${column}`. Null values are surfaced as an explicit checkbox entry (`NULL_OPTION_KEY`) so learners can include or exclude nulls with the rest of the in-list options.
3. **Datetime prefills** – When a datetime column/operator is chosen, the component fetches `nodesApi.describeColumn` to seed the appropriate min/median/max values (or ranges for `between`). This keeps the UI from sending empty ISO strings and mirrors the legacy component behavior, but now the helper lives next to the hook/harness instead of inside the shared components directory.
4. **Preview + pagination** – `filterPreviewRequest` memoizes `{ nodeId, payload }` and feeds it into `usePreprocessingPreview`. That hook exposes `setPage`/`setPageSize`, so the tab can drive Previous/Next buttons without duplicating fetch logic. Pagination buttons now pass explicit numbers (`setPreviewPage(Math.max(1, currentPreviewPage - 1))`) to match the hook’s `(page: number) => void` signature.
5. **Workspace integration** – The JSX still renders `<NodeSelectionPanel>` and preview cards exactly like before, so `DataPreprocessingFeature` simply swaps its import to `../../preprocessing/filter/FilterSubTab` and keeps the same props (`selectedNodeId`, `selectedNodes`, `nodeData`, `filterNode`, `filterPreview`, etc.).

6. **Condition builder primitives** – The bulky inline JSX that previously handled column/operator/value wiring now lives in `frontend/src/features/preprocessing/components/condition-builder/ConditionBuilder.tsx`. Filter passes `renderConditionMetadata` (for negate/regex toggles) and `renderValueInput`, so additional subtabs can reuse the same scaffolding by swapping in their own metadata/value editors.

**Result**: The filter experience is identical in the UI, but the shared hook (`usePreprocessingPreview`), serializers, preview table, and condition builder all live under `src/features/preprocessing`. This reduces cross-package imports and provides drop-in primitives for the remaining subtabs (slice, concat, aggregate) as they migrate.

##### ConditionBuilder (`frontend/src/features/preprocessing/components/condition-builder/ConditionBuilder.tsx`)

**Purpose**: Shared UI skeleton for column-based condition builders. It renders the “Add condition” CTA, AND/OR logic selector, column/operator dropdowns, and defers value/input rendering to feature-specific callbacks.

**Implementation Notes**:

- Accepts a typed list of condition records (must expose `id`, `column`, `operator`, optional `dataType`).
- Provides hooks for feature-specific behavior: `renderValueInput` (value editors), `renderConditionMetadata` (toggles such as negate/regex), `getOperatorOptions`, and `shouldHideOperatorSelect` for data types with fixed operators (e.g., categoricals forced to `IN`).
- Handles empty states automatically: “Select a node…”, “Retrieving column information…”, and “No schema yet.” Callers can override the copy via props.
- Because the component is framework-agnostic (no filter-specific imports), other subtabs can share it simply by reusing the same prop contract.

##### SliceSubTab (`frontend/src/features/preprocessing/slice/SliceSubTab.tsx`)

**Purpose**: Feature-sliced rewrite of the legacy slicing UI. The component now lives under `src/features/preprocessing/slice/` and shares the same preview engine, preview table, and NodeSelectionPanel wiring as the Filter tab.

**Highlights**:

1. **Shared preview engine** – Uses `usePreprocessingPreview` with a 400 ms debounce and a typed fetcher to call `slicePreview(nodeId, payload, page, pageSize)`. The hook manages pagination, abort controllers, and request deduplication.
2. **Range helpers** – `rangeSummary` and `lastResultSummary` remain, but they’re now derived via `useMemo` inside the feature module so the card footer always reflects the current offset/length and last successful slice operation.
3. **Workspace integration** – Node selection, palette management, and disabled states reuse the same helper functions defined in the module (`buildWorkspaceNodeMap`, `deriveNodeLabel`). The `NodeSelectionPanel` stays unchanged, so DataPreprocessingFeature only needed to update its import path.
4. **Single source of truth** – The former `src/components/preprocessing/SliceSubTab.tsx` shim has been deleted, so every caller imports this module directly and there is no duplicated wrapper logic.

**Result**: Slice previews, range validation, and node creation now share the same preview/pagination primitives as Filter. The module dropped ~1000 lines of bespoke preview plumbing and is ready for further decomposition (e.g., extracting the range form into a smaller component) without touching the legacy components directory.

##### JoinSubTab (`frontend/src/features/preprocessing/join/JoinSubTab.tsx`)

**Purpose**: Migrates the preprocessing “Join” surface into the feature-sliced preprocessing folder, wiring it to the shared preview engine and condition-builder primitives so future subtabs can drop in without touching the now-retired `src/components/preprocessing` directory.

**Highlights**:

1. **Typed preview payloads** – Introduces `JoinPreviewRequestPayload` in `src/features/preprocessing/types.ts`, documenting `{ leftNodeId, rightNodeId, joinType, columnPairs, limit, offset }`. Both the preview hook and the “Apply” mutation share this shape, keeping debounce + submission in sync.
2. **`usePreprocessingPreview` integration** – The join tab passes a `joinPreviewFetcher` that calls `nodesApi.joinPreview({ workspaceId, leftNodeId, rightNodeId, payload, page, pageSize })`. The hook manages pagination, abort signals, and deduplicated debounced requests exactly like Filter/Slice, so the tab only renders pagination controls.
3. **Column pair editor** – Local helpers derive columns for the left/right nodes from `nodeData` and gate form controls until both nodes expose schema data. Pairs are stored as `{ leftColumn, rightColumn }` records keyed by `uuidv4`, mirroring the condition-builder contract so drag-and-drop ordering or quick deletions remain trivial.
4. **NodeSelectionPanel parity** – Joins continue to use `<NodeSelectionPanel>` for picking the primary node plus right-hand partner. The feature module reuses the shared workspace selectors and disabled states, so `DataPreprocessingFeature` simply swaps imports and props stay identical (`selectedNodeId`, `selectedNodes`, `nodeData`, etc.).
5. **Single import path** – With the wrapper directory removed, `DataPreprocessingFeature` (and any future consumers) import this component directly from `src/features/preprocessing/join/JoinSubTab`, guaranteeing there is exactly one implementation in play.

**Result**: The Join UI now benefits from the same preview/pagination infrastructure as Filter and Slice, eliminates bespoke axios calls, and keeps all preprocessing subtabs under a single folder with shared hooks/components.

##### ConcatSubTab (`frontend/src/features/preprocessing/concat/ConcatSubTab.tsx`)

**Purpose**: Feature-sliced rewrite of the “Concat” sub-tab that was previously 500+ lines of bespoke preview logic. The new module lives beside the other preprocessing features and consumes the shared preview hook/table so pagination, error handling, and node selection behave consistently.

**Highlights**:

1. **Workspace-aware schema analysis** – Reuses the legacy schema comparison routines (now colocated with the feature) to validate that each selected node exposes the same sorted column set and compatible dtypes. The analysis object drives both the status banner and the preview eligibility gate.
2. **Shared preview engine** – Builds a `{ nodeIds }` payload and passes it to `usePreprocessingPreview`, which debounces calls to `workspaceActions.concatPreview`, manages abort signals, and surfaces pagination setters. The component now only handles Prev/Next/page-size buttons and hands the rest to `PreviewTable`.
3. **Palette + NodeSelectionPanel reuse** – Keeps the richer node status cards by feeding `NodeSelectionPanel` directly from the feature, but the component now lives alongside the slice/join implementations, eliminating deep `../..` import chains.
4. **Single implementation** – The old `src/components/preprocessing/ConcatSubTab.tsx` file has been removed, so the feature module is now the only implementation and no commented legacy fallback remains.

**Result**: Concat now shares preview/pagination infrastructure, and the components directory no longer contains divergent business logic—only a thin shim that can be removed once downstream consumers swap to the feature import.

##### AggregateSubTab (`frontend/src/features/preprocessing/aggregate/AggregateSubTab.tsx`)

**Purpose**: Moves the computed-column builder into the feature-scoped preprocessing folder. The UI still exposes both the drag-and-drop “Basic” builder and the raw expression editor, but the logic now sits next to the rest of the preprocessing toolkit for easier sharing (e.g., future expression token components).

**Highlights**:

1. **Node selection + schema access** – Continues to rely on `NodeSelectionPanel` for highlighting the active node and retrieving column metadata via `mapColumnsToInfo`, but the new location means the component can import the shared panel directly through the features workspace (no deep `../..` chains).
2. **Expression builder plumbing** – All drag/drop helpers, token editing flows, and smart-quote normalization live inside the feature module, making it straightforward to extract `ExpressionBuilder` or token palette components later without touching the components directory.
3. **Preview + apply hooks** – The tab still calls `useWorkspaceActions().computeColumnPreview/computeColumn`, but the data/alert wiring now matches the other feature subtabs. With the old `src/components/preprocessing` entrypoint removed, the feature module is the canonical surface and there is no redundant wrapper to maintain.

**Result**: Aggregate now resides with the rest of the preprocessing suite, eliminating another legacy component and ensuring future shared helpers (token palettes, preview harnesses) can evolve inside `src/features/preprocessing`.

##### DataLoaderFeature (`frontend/src/features/analysis/data-loader/DataLoaderFeature.tsx`)

**Purpose**: Provide the “Data Loader” tab that students use to (1) create/select workspaces, (2) upload local corpora or import the backend’s sample datasets, and (3) push uploaded files into the active workspace as nodes before moving on to analysis subtabs.

**Workflow Recap**:
1. *Pick an active workspace* – the component pulls `{ workspaces, currentWorkspaceId, workspaceGraph }` from `useWorkspaceData()` and mirrors the selection via `useWorkspaceActions().setCurrentWorkspace`. The summary card also surfaces node counts (`workspaceGraph?.nodes.length`) plus created/modified timestamps so learners can tell which workspace they’re editing.
2. *Manage workspace metadata* – rename/save/save-as buttons call the memoized workspace mutations (`renameWorkspace`, `saveWorkspace`, `saveWorkspaceAs`) that live inside `useWorkspaceNodeMutations`. The “Create workspace” form simply forwards the name/description to `createWorkspace`, while delete buttons call `deleteWorkspace(workspaceId)` after a confirmation prompt.
3. *Upload and inspect files* – `useFiles({ authHeaders })` drives the file table, leveraging the existing TanStack Query cache for `/files/`. Uploads flow through `handleUploadFile`, deletes though `handleDeleteFile`, downloads via `handleDownloadFile`, and “Import sample data” is wired straight to `filesApi.importSampleData`. The component renders `FilePreviewPanel` and `AddFilePanel` as dialogs so learners can preview/inspect a file before adding it to the workspace.
4. *Add a file to the active workspace* – when the learner clicks **Add**, the component opens `AddFilePanel` and, on confirmation, dispatches `createNodeFromFile(filename, { mode, documentColumn })`. Success and failure states feed a single `statusMessage` banner, giving immediate feedback without exposing implementation details.

**Implementation Highlights**:
- Uses lightweight helpers (`formatBytes`, `formatTimestamp`) so the file table can display human-readable metadata without reformatting on every render.
- Maintains a single `statusMessage` state with auto-dismissal via `useEffect`, ensuring uploads/imports/CRUD actions surface success and error feedback consistently.
- Reuses shadcn-inspired UI primitives (`Card`, `Table`, `Badge`) and lucide icons (`Upload`, `FolderPlus`, `Trash2`) to keep the Data Loader tab visually aligned with the rest of the analysis surface.
- Keeps the file input hidden and triggered via a primary **Upload file** button, which mirrors the legacy UX but now sits inline with the “Import sample data” CTA.
- Guards workspace-only actions—renaming, saving, and adding files—behind `hasWorkspaceSelected` so the tab gently nudges learners to pick/create a workspace before attempting downstream transformations.

**Example** – adding an uploaded CSV as a DocLazyFrame:

```tsx
const [addFileName, setAddFileName] = useState<string | null>(null);

<Button onClick={() => {
  if (!currentWorkspaceId) {
    setStatusMessage({ type: 'error', text: 'Select a workspace first.' });
    return;
  }
  setAddFileName(file.filename);
}}>
  Add
</Button>

<AddFilePanel
  filename={addFileName}
  open={Boolean(addFileName)}
  onClose={() => setAddFileName(null)}
  onConfirm={(options) => workspaceActions.createNodeFromFile(addFileName!, options)}
/>
```

That snippet shows the same “question → answer” rhythm used in tutorials: once the learner clicks **Add**, the dialog gathers DocFrame mode + document column and then calls `createNodeFromFile`. The surrounding status banner reports whether the mutation succeeded so students know when it’s safe to switch into the preprocessing or analysis tabs.

##### API Client (`api/client.ts`)

**Purpose**: Axios instance with authentication and error handling.

**Implementation**:
- Base URL detection: Auto-detects backend URL (localhost, JupyterHub proxy, production)
- Auth interceptor: Adds `Authorization: Bearer {token}` header to all requests
- Error handling: Catches 401 (redirects to login), 403 (shows error), 500 (shows error)

**Auto-Detection Logic**:
```typescript
export const getApiBaseUrl = (): string => {
  // 1. Explicit override
  if (import.meta.env.VITE_BACKEND_API_BASE) {
    return import.meta.env.VITE_BACKEND_API_BASE;
  }
  
  // 2. Detect JupyterHub/Binder proxy
  const path = window.location.pathname;
  if (path.includes('/user/')) {
    const match = path.match(/\/user\/[^/]+/);
    return `${match[0]}/proxy/${backendPort}/api`;
  }
  
  // 3. Localhost
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `http://localhost:${backendPort}/api`;
  }
  
  // 4. Production (same origin)
  return '/api';
};
```

**Auth Interceptor**:
```typescript
client.interceptors.request.use(config => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

#### State Management

##### Workspace hook stack (`hooks/workspace/*` + `hooks/useWorkspaceInternal.ts`)

**Purpose**: Split the 1.2k-line monolith into focused hooks while keeping `WorkspaceProvider` the single wiring point. `useWorkspaceInternal()` now composes:

- `useWorkspaceCore.ts` – owns auth headers, the current workspace id, selection/pagination helpers (via Zustand selectors), and UI operation bookkeeping. It exposes memoized setters (`handlePageChange`, `handlePageSizeChange`) plus normalized loading/error maps.
- `useWorkspaceQueries.ts` – runs every TanStack Query fetch (workspaces list, current workspace, graph, node data, node shape cache) using the data provided by `useWorkspaceCore`. Returns derived arrays like `nodes`, `selectedNode`, `selectedNodes`, and aggregated loading/error objects.
- `useWorkspaceNodeMutations.ts` – encapsulates workspace/node mutations and their invalidation/configuration logic (workspace CRUD, joins, casts, conversions, schema refresh, etc.). It expects the state setters from `useWorkspaceCore`, so selection clears and pagination resets stay centralized.
- `useWorkspaceInternal.ts` – stitches the three hooks together, adds the text-task mutations (concordance/quotation) plus selection helpers, and exports the same `{ data, selection, actions, status }` slices that `WorkspaceProvider` already exposes.

**Query Keys** (`lib/queryKeys.ts`):
```typescript
export const queryKeys = {
  workspaces: ['workspaces'] as const,
  currentWorkspace: ['workspaces', 'current'] as const,
  workspace: (id: string) => ['workspaces', id] as const,
  workspaceGraph: (id: string) => ['workspaces', id, 'graph'] as const,
  nodeData: (workspaceId: string, nodeId: string, page?: number, pageSize?: number) =>
    page !== undefined && pageSize !== undefined
      ? ['workspaces', workspaceId, 'nodes', nodeId, 'data', page, pageSize] as const
      : ['workspaces', workspaceId, 'nodes', nodeId, 'data'] as const,
  nodeSchema: (workspaceId: string, nodeId: string) => ['workspaces', workspaceId, 'nodes', nodeId, 'schema'] as const,
};
```

**Central Hook Composition**:
```typescript
export const useWorkspaceInternal = () => {
  const core = useWorkspaceCore();
  const queries = useWorkspaceQueries({
    authHeaders: core.authHeaders,
    isAuthenticated: core.isAuthenticated,
    currentWorkspaceId: core.currentWorkspaceId,
    selectedNodeId: core.selectedNodeId,
    selectedNodeIds: core.selectedNodeIds,
    getPaginationForNode: core.getPaginationForNode,
  });

  const { actions: nodeActions } = useWorkspaceNodeMutations({
    authHeaders: core.authHeaders,
    currentWorkspaceId: core.currentWorkspaceId,
    selectedNodeId: core.selectedNodeId,
    setCurrentWorkspaceId: core.setCurrentWorkspaceId,
    setSelectedNodes: core.setSelectedNodes,
    clearSelection: core.clearSelection,
    queryClient,
    startOperation: core.startOperation,
    endOperation: core.endOperation,
    setOperationError: core.setOperationError,
  });

  const textActions = useMemo(() => ({
    concordanceSearch: (nodeId, request) =>
      concordanceMutation.mutateAsync({ workspaceId: ensureWorkspaceSelected(), nodeId, request }),
    quotationSearch: (nodeId, request) =>
      quotationMutation.mutateAsync({ workspaceId: ensureWorkspaceSelected(), nodeId, request }),
    // ...detach helpers
  }), [concordanceMutation, quotationMutation, ensureWorkspaceSelected]);

  return {
    workspaces: queries.workspaces,
    workspaceGraph: queries.workspaceGraph,
    nodeData: queries.nodeData,
    isLoading: {
      ...queries.queryLoadingState,
      operations: core.loadingOperationCount > 0,
    },
    actions: {
      selectNode: core.selectNode,
      ...nodeActions,
      ...textActions,
    },
    handlePageChange: core.handlePageChange,
    handlePageSizeChange: core.handlePageSizeChange,
  };
};
```

**Invalidation Pattern** (now lives inside `useWorkspaceNodeMutations.ts`):
```typescript
const setCurrentWorkspaceMutation = useMutation({
  mutationFn: (workspaceId: string | null) => workspacesApi.current.set(workspaceId, authHeaders),
  onSuccess: (_data, workspaceId, context) => {
    const nextId = workspaceId ?? null;
    queryClient.setQueryData(queryKeys.currentWorkspace, nextId);
    setCurrentWorkspaceId(nextId);
    clearSelection();

    if (nextId) {
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) =>
          Array.isArray(queryKey) &&
          queryKey[0] === 'workspaces' &&
          queryKey[1] === nextId &&
          queryKey.length > 1,
      });
    }
  },
});
```

##### Zustand Stores (`selectionStore.ts`, `workspaceStore.ts`, `analysisStore.ts`)

**selectionStore.ts** – Owns all node/graph selection and per-node pagination. `WorkspaceGraphView`, `SidebarNodesSection`, and every tab consume the same getters so there is zero divergence.
```typescript
export const useSelectionStore = create<SelectionStore>()(
  devtools(immer((set, get) => ({
    selectedNodeId: null,
    selectedNodeIds: [],
    selectNode: (nodeId) => set((state) => {
      state.selectedNodeId = nodeId;
      state.selectedNodeIds = nodeId ? [nodeId] : [];
    }),
    setSelectedNodes: (ids) => set((state) => {
      state.selectedNodeIds = ids;
      state.selectedNodeId = ids[0] ?? null;
    }),
    toggleNodeSelection: (nodeId) => set((state) => {
      const isSelected = state.selectedNodeIds.includes(nodeId);
      state.selectedNodeIds = isSelected
        ? state.selectedNodeIds.filter((id) => id !== nodeId)
        : [...state.selectedNodeIds, nodeId];
      state.selectedNodeId = state.selectedNodeIds[0] ?? null;
    }),
    // ...pagination helpers omitted for brevity
  })))
);
```

**workspaceStore.ts** – Tracks the workspace id, graph viewport, and long-lived operation flags (pending deletes, renames, joins). Switching workspaces resets the entire slice so stale pagination/graph zoom does not leak across sessions.

**analysisStore.ts** – Acts as the inbox for background tasks. `useWorkspaceTaskInbox` (and the compatibility hook `useWorkspaceTaskStream`) write SSE payloads into `setTasks`, while `useAnalysisTaskStatus` / `useAnalysisTaskLifecycle` derive banners and poll/refresh behavior for Concordance and Topic Modeling tabs as well as the Sidebar’s Tasks list.

##### Analysis Task Lifecycle (`hooks/useAnalysisTaskLifecycle.ts`)

**Purpose**: Centralize analysis task UX (banners, polling, and result refresh) for Concordance, Topic Modeling, and future analysis tabs. The hook wraps `useAnalysisTaskStatus` and the SSE-driven task inbox (via `useWorkspaceTaskStream`) so each tab no longer re-implements the same polling/terminal-handling logic, even as the low-level SSE client moves into the feature module.

**Inputs**:

- `taskType`: Backend task type (`'concordance'`, `'topic_modeling'`, etc.) used to filter `analysisStore.tasks`.
- `workspaceId`: Ensures polling/refresh only runs when a workspace is mounted; also resets internal refs when the user switches workspaces.
- `manualActiveTaskId` *(optional)*: Allows tabs to pass the task id returned from an immediate POST response before the SSE stream echoes the task. Concordance uses this to start polling immediately after `/concordance` responds.
- `fallbackRunningBanner`: Either a static object or a resolver function `(status) => BannerFallback | null`. Tabs provide a resolver so `AnalysisTaskBanner` can still show a spinner when the current result says `state: 'running'` even if the SSE queue hasn’t emitted a queued/running task yet.
- `pollWhileActive`/`pollIntervalMs`: Enables lightweight polling for analyses whose results are only exposed via `/current-result` (Concordance). Topic Modeling leaves polling off because the SSE stream plus `topicModelingReady` markers are sufficient.
- `onRefresh(context)`: Async callback invoked for two reasons:
  - `context.reason === 'poll'`: Fired on the configured interval while a task is active.
  - `context.reason === 'terminal'`: Fired once per terminal task transition (`successful`, `failed`, `cancelled`). The context exposes `task`, `taskId`, and `taskState` so tabs can decide how to fetch or synthesize their UI state.

**Behavior**:

1. **Banner Synthesis** – Computes an `AnalysisTaskBannerState` by checking `status.bannerStatus` (running/queued from SSE). If no official status exists, the fallback resolver runs so tabs can derive a “running” message from their cached `result` payload.
2. **Polling Loop** – When `pollWhileActive` is true and either the SSE state or `manualActiveTaskId` indicates an active task, the hook schedules a `window.setInterval` and repeatedly calls `onRefresh({reason: 'poll', ...})`. React cleans up the timer automatically when dependencies change.
3. **Terminal Deduplication** – Internally tracks `{taskId, state}` pairs so `onRefresh({reason: 'terminal'})` only fires once per completion even if Zustand re-renders multiple times.

**Example (Concordance Tab)**:

```tsx
const concordanceFallback = useCallback((status: AnalysisTaskStatus) => {
  if (results?.state !== 'running') return null;
  return {
    taskId: (results as any)?.metadata?.task_id ?? status.activeTaskId,
    message: status.bannerMessage?.trim() || undefined,
  };
}, [results]);

const handleTaskRefresh = useCallback(async (ctx: AnalysisTaskRefreshContext) => {
  const refreshed = await refreshCurrentConcordanceResult();
  if (!refreshed && ctx.reason === 'terminal' && ctx.taskState === 'failed') {
    setResults({ state: 'failed', message: ctx.task?.message, data: {} });
  }
}, [refreshCurrentConcordanceResult]);

const { banner } = useAnalysisTaskLifecycle({
  taskType: 'concordance',
  workspaceId: currentWorkspaceId,
  manualActiveTaskId,
  fallbackRunningBanner: concordanceFallback,
  pollWhileActive: true,
  onRefresh: handleTaskRefresh,
});
```

TopicModelingTab uses the same hook but disables polling and hands `onRefresh` off to `fetchTopicModelingResult`. When SSE reports a persisted `topic_modeling` task the hook makes exactly one `GET /topic-modeling/current-result` call, eliminating the bespoke `useEffect` blocks that previously watched `successfulTask`/`failedTask` manually.

## Data Flow Patterns

### Pattern 1: Loading File as Node

```
User uploads file via frontend
    ↓
POST /api/files/upload → saves to {USER_DATA_FOLDER}/uploads/{user_id}/{filename}
    ↓
User clicks "Load File" in workspace
    ↓
Frontend: POST /api/workspaces/{workspace_id}/nodes/load {filepath, name}
    ↓
Backend: api/workspaces/nodes.py load_file_as_node()
  1. Get workspace via WorkspaceManager.load(user_id, workspace_id)
  2. Resolve full file path from USER_DATA_FOLDER
  3. Load file: `core.utils.load_data_file(filepath)` → Polars LazyFrame/DataFrame or
     DocDataFrame depending on detected type
     - CSV/TSV/Parquet: `pl.scan_csv` / `pl.scan_parquet` for lazy loading
     - JSON: `pl.read_json`
     - ZIP: `docframe.read_zip`
     - Plain text (`.txt/.text/.md/.rst/.log`): `docframe.read_text` (single row with
       document + metadata)
  4. Create node: Node(data, name, workspace)
  5. Node auto-adds to workspace (workspace.add_node() called internally)
  6. Persist workspace: WorkspaceManager.persist(user_id, workspace_id, workspace)
  7. Convert node to API format: DocWorkspaceAPIUtils.convert_node_info_for_api(node)
    ↓
Return node info JSON to frontend
    ↓
Frontend: Invalidates workspaceGraph query
    ↓
TanStack Query refetches workspace graph
    ↓
WorkspaceGraph component re-renders with new node
```

**Key Insight**: Node creation triggers workspace persistence, graph invalidation causes UI refresh.

### Pattern 2: Filtering Node

```
User selects node in WorkspaceGraph
    ↓
Frontend stores selectedNodes in Zustand
    ↓
User opens filter panel, enters filter expression "pl.col('score') > 0.5"
    ↓
Frontend: POST /api/workspaces/{workspace_id}/nodes/{node_id}/filter {expression}
    ↓
Backend: api/workspaces/nodes.py filter_node()
  1. Load workspace
  2. Get source node: workspace.nodes[node_id]
  3. Parse expression: eval(expression) → pl.Expr (SECURITY: sanitized in production)
  4. Apply filter: child_node = source_node.filter(expr)
    - node.filter() implementation:
      * Calls data.filter(expr) → filtered DataFrame/LazyFrame
      * Wraps in new Node with auto-generated name
      * Links parent: child_node.parents.append(source_node)
      * Links child: source_node.children.append(child_node)
      * Adds to workspace: workspace.add_node(child_node)
  5. Persist workspace
  6. Convert child node to API format
    ↓
Return child node info to frontend
    ↓
Frontend: Invalidates workspaceGraph query
    ↓
WorkspaceGraph refetches and shows new node with edge from parent
```

**Key Insight**: Filter operation creates child node with parent relationship; graph automatically shows edge.

### Pattern 3: Token Frequency Analysis

```
User selects multiple nodes in graph (e.g., node1, node2)
    ↓
Frontend stores selectedNodes = [node1.id, node2.id] in Zustand
    ↓
User clicks "Compare Token Frequencies"
    ↓
Frontend: POST /api/workspaces/{workspace_id}/analysis/token-frequencies
  {node_ids: [node1.id, node2.id], column: 'document', token_limit: 100}
    ↓
Backend: api/workspaces/analysis.py compute_token_frequencies_endpoint()
  1. Load workspace
  2. Get nodes: frames = {n.name: n for n in [workspace.nodes[id] for id in node_ids]}
  3. Call docframe utility: 
     freq_dicts, stats_df = compute_token_frequencies(frames, stop_words=None)
       - Implementation (docframe/core/text_utils.py):
         * For each frame: tokenize document column, flatten to token list
         * Build universal vocabulary (union of all tokens across frames)
         * For each frame: count token frequencies, ensure all vocab present
         * If 2 frames: compute log-likelihood statistics
           - Expected frequency: (token_total * corpus_total) / grand_total
           - G² statistic: 2 * Σ(observed * log(observed/expected))
           - Bayes Factor (BIC): G² - (dof * log(grand_total))
           - Effect Size (ELL): G² / (grand_total * log(min_expected))
         * Return (freq_dicts, stats_df)
        * Backend intentionally ignores `token_limit` when generating `freq_dicts`; truncation is now 100% a presentation concern handled in the UI.
  4. Generate analysis ID: str(uuid.uuid4())
  5. Store results in workspace metadata: workspace.set_metadata(f"analysis_{analysis_id}", result)
  6. Persist workspace
  7. Return {analysis_id, frequencies: freq_dicts, statistics: stats_df.to_dicts()}
    ↓
Frontend: Receives analysis result
  1. Stores in TanStack Query cache: queryKey ['analysis', workspace_id, analysis_id]
  2. Locks analysis: setLastCompareNodeIds([node1.id, node2.id])
  3. Reads metadata (`total_tokens_before_limit`, `applied_server_limit`, `token_limit`) so it can explain to the learner that the server returned every token and the UI will now slice locally.
  4. Renders TokenFrequencyTab:
     - Unified word cloud (combined frequencies)
     - Per-node word clouds
     - Statistics table (sorted by log-likelihood)

> **Walkthrough Q**: *If the backend returns every token, why keep `token_limit` in the payload?*
>
> **Answer**: Treat `token_limit` as a persisted preference, not a hard cap. The backend copies it into `analysis_params.token_limit` and `metadata.token_limit` so the UI can (a) remember the student’s preferred table length, (b) label results with `applied_server_limit = null` when nothing was truncated, and (c) apply the limit client-side without recomputing the analysis. This separation keeps the data layer lossless while the presentation layer stays friendly for beginners.
```

**Key Insight**: Analysis results stored in workspace metadata; frontend locks analysis to prevent UI changes on new node selection.

### Pattern 4: Workspace Graph Rendering

```
User opens workspace page
    ↓
Frontend: GET /api/workspaces/{workspace_id}
    ↓
Backend: api/workspaces/base.py get_workspace()
  1. Load workspace via WorkspaceManager.load(user_id, workspace_id)
  2. Convert to React Flow format:
     graph = DocWorkspaceAPIUtils.workspace_to_react_flow(workspace, layout_algorithm='grid')
       - Implementation:
         * For each node in workspace.nodes:
           - Calculate position using layout algorithm
           - Create ReactFlowNode with:
             id, type='customNode', position={x, y},
             data={label, nodeType, isLazy, shape, columns}
         * For each node with parents:
           - Create ReactFlowEdge with:
             id=f"edge-{n}", source=parent.id, target=node.id, type='smoothstep'
         * Create WorkspaceInfo with:
             id, name, total_nodes, root_nodes, leaf_nodes, created_at, modified_at
         * Return WorkspaceGraph(nodes, edges, workspace_info)
  3. Return graph JSON
    ↓
Frontend: Receives graph data
  1. Stores in TanStack Query cache: queryKey ['workspaceGraph', workspace_id]
  2. Passes to WorkspaceGraph component
  3. WorkspaceGraph renders:
     <ReactFlow
       nodes={graph.nodes}           // Positioned nodes
       edges={graph.edges}           // Parent→child edges
       nodeTypes={{customNode: CustomNode}}
       onNodeClick={handleNodeClick}
     />
  4. Renders nodes using CustomNode component:
     - Shows label (node.name)
     - Shows type badge (DataFrame/LazyFrame/DocDataFrame/DocLazyFrame)
     - Shows shape (rows × columns)
     - Shows lazy indicator if applicable
  5. Renders edges as smooth curves between nodes
```

**Key Insight**: Backend provides fully positioned graph; frontend only renders (no layout computation in browser).

### Workspace Feature Modules (Frontend)

The workspace screen is now implemented using feature-scoped modules under `frontend/src/features/workspace`. Each surface exposes a single feature component that layouts orchestrate (e.g., `WorkspaceDataView` and `WorkspaceGraphView` simply memo-wrap these features).

#### Data View (`features/workspace/data-view`)

- **Hook – `useWorkspaceDataTable`**: Centralizes every selector for the data table (selected node metadata, TanStack Table pagination handlers, mutation callbacks). The hook also tracks tab ordering for multi-selection and pulls actual shapes on-demand via `getNodeShape`.
- **Services – `services/schemaMutations.ts`**: Pure helpers that normalize type names, manage column mutation payloads, and keep table metadata consistent when casting/renaming columns.
- **Presentational Components**:
  - `WorkspaceSelectionTabs` renders pills that reflect Zustand selections and exposes drag-friendly reordering callbacks supplied by the hook.
  - `WorkspaceDataHeader` surfaces node title + shape readings with “rows loaded” status.
  - `WorkspaceTable` wraps TanStack Table and hosts all column pinning logic, datetime format modals, column deletion dialogs, etc.
  - `TablePaginationControls` provides the shared pagination footer with ellipsis-jump support.
- **Feature Entry – `WorkspaceDataTableFeature`**: Orchestrates the hook + components, chooses loading/empty states, and feeds sanitized props into `WorkspaceTable`. Layout components now stay lean and simply mount this feature.

#### Graph View (`features/workspace/graph-view`)

- **Services – `services/graphLayout.ts`**: Houses the Dagre-based auto-layout (LR rank, sticky node widths/heights) so the behavior is shareable across hooks/tests.
- **Hook – `useWorkspaceGraph`**: Migrates every side effect that previously lived in `WorkspaceGraphView`:
  - Builds React Flow nodes/edges, including shape inference, data type detection, and selection flags.
  - Exposes fully prepared handlers (`handleNodeClick`, `handleNodesChange`, `handlePaneClick`, etc.) and keeps React Flow state synchronized with Zustand selections.
  - Provides default edge styling, connection blockers, and the “clear selection” control wiring.
- **Feature Entry – `WorkspaceGraphFeature`**: Imports XYFlow styles, renders loading/empty states, manages local “overview” toggle state, and composes `<ReactFlow>` with the hook’s props. The node-count overlay and control buttons live here, so layouts stay declarative.

These feature modules allow other surfaces (desktop shell, multi-pane layouts) to reuse the workspace data/graph experiences without pulling in unrelated UI or state management code.

## Extension Points

### 1. Adding New Workspace Operations

**Where**: `backend/api/workspaces/nodes.py` or create new router module

**Pattern**:
```python
@router.post("/{workspace_id}/nodes/{node_id}/custom-operation")
async def custom_operation(
    workspace_id: str,
    node_id: str,
    params: CustomOperationParams,  # Pydantic model
    current_user: dict = Depends(get_current_user),
):
    """Custom operation on node."""
    user_id = current_user["id"]
    workspace_manager = WorkspaceManager(settings)
    
    # Load workspace
    workspace = workspace_manager.load(user_id, workspace_id)
    if not workspace:
        raise HTTPException(404, "Workspace not found")
    
    # Get node
    node = workspace.nodes.get(node_id)
    if not node:
        raise HTTPException(404, "Node not found")
    
    # Perform operation (creates new node with relationship)
    result_node = node.custom_method(params.value)
    
    # Persist workspace
    workspace_manager.persist(user_id, workspace_id)
    
    # Return result
    return DocWorkspaceAPIUtils.convert_node_info_for_api(result_node)
```

### 2. Adding New Analysis Methods

**Where**: `backend/api/workspaces/analysis.py`

**Pattern**:
```python
@router.post("/{workspace_id}/analysis/custom-analysis")
async def custom_analysis(
    workspace_id: str,
    node_ids: List[str],
    current_user: dict = Depends(get_current_user),
):
    """Run custom analysis on selected nodes."""
    workspace_manager = WorkspaceManager(settings)
    workspace = workspace_manager.load(current_user["id"], workspace_id)
    
    # Get nodes
    nodes = [workspace.nodes[nid] for nid in node_ids]
    
    # Run analysis (use docframe utilities or custom logic)
    results = custom_analysis_function(nodes)
    
    # Store in workspace metadata
    analysis_id = str(uuid.uuid4())
    workspace.set_metadata(f"analysis_{analysis_id}", results)
    workspace_manager.persist(current_user["id"], workspace_id)
    
    return {"analysis_id": analysis_id, "results": results}
```

### 3. Adding New Frontend Components

**Where**: `frontend/src/features/analysis/*` (feature-first slices)

**Pattern**:
```tsx
// CustomAnalysisTab.tsx
export const CustomAnalysisTab = () => {
  const {selectedNodes} = useWorkspaceStore();
  const {workspaceId} = useParams();
  
  // API call using TanStack Query mutation
  const analysisMutation = useMutation({
    mutationFn: (params) => api.customAnalysis(workspaceId, params),
    onSuccess: (data) => {
      // Update query cache
      queryClient.setQueryData(
        ['customAnalysis', workspaceId, data.analysis_id],
        data.results
      );
    },
  });
  
  const handleRun = () => {
    analysisMutation.mutate({node_ids: selectedNodes});
  };
  
  return (
    <div>
      <Button onClick={handleRun} disabled={selectedNodes.length === 0}>
        Run Custom Analysis
      </Button>
      {analysisMutation.data && (
        <ResultsDisplay results={analysisMutation.data.results} />
      )}
    </div>
  );
};
```

### 4. Adding New Node Types to DocWorkspace

**Where**: `docworkspace/src/docworkspace/node/core.py`

**Pattern**:
```python
# Add to SupportedDataTypes
from new_library import CustomDataFrame

SupportedDataTypes = (
    DataFrame | LazyFrame | DocDataFrame | DocLazyFrame | CustomDataFrame
)

# Add to extract_polars_data()
def extract_polars_data(data):
    if isinstance(data, CustomDataFrame):
        return data.to_polars()  # Convert to Polars format
    # ... existing logic

# Node will automatically support CustomDataFrame via __getattr__ delegation
```

## Performance Considerations

### Lazy Evaluation

**DocWorkspace + Polars LazyFrame**:
- Operations on LazyFrame nodes remain lazy until `.collect()` called
- Backend endpoints should avoid materializing large lazy frames
- Frontend pagination uses `node.data.slice(start, end).collect()` to materialize only visible rows

**Example**:
```python
# Efficient: only materializes 100 rows
data = node.data.slice(page * page_size, page_size).collect()

# Inefficient: materializes entire dataset
data = node.collect().data[page * page_size:(page + 1) * page_size]
```

### Workspace Serialization

**Large Workspaces**:
- Serialize only metadata + node references, not full data
- Store large node data separately (e.g., Parquet files)
- Use `DocDataFrame.serialize(include_data=False)` for metadata-only serialization

**Optimization**:
```python
# Serialize workspace without embedding large DataFrames
workspace.serialize("workspace.json", include_large_data=False)

# Node data stored separately
for node in workspace.nodes.values():
    if node.data.shape[0] > 10000:  # Large node
        node.data.write_parquet(f"nodes/{node.id}.parquet")
```

### Frontend State Management

**TanStack Query Caching**:
- `staleTime`: How long data considered fresh (default: 0, immediate refetch)
- `gcTime` (formerly `cacheTime`): How long unused data kept in cache (default: 5min)
- Adjust per query type:
  - Workspace graph: `staleTime: 30000` (30s, relatively static)
  - Node data: `staleTime: 10000` (10s, may change frequently)
  - Analysis results: `staleTime: Infinity` (immutable once computed)

**Zustand Store Optimization**:
- Use selectors to prevent unnecessary re-renders:
  ```typescript
  // Only re-renders when selectedNodes changes
  const selectedNodes = useWorkspaceStore(state => state.selectedNodes);
  
  // Re-renders on any store change (avoid!)
  const store = useWorkspaceStore();
  ```

### Tutorial: Startup Readiness Flow (Desktop + Web)

**Goal**: walk through what the React shell now does before showing any workspace UI. Assume we are teaching a brand-new team member how the desktop build waits for the FastAPI backend and the authentication handshake.

1. **Step 1 – Ask “Is the backend awake?”**  
   *Question*: *What happens the moment the shell boots but `/health` is not ready yet?*  
   *Answer*: `useBackendHealth()` polls the resolved `/health` URL (Tauri injects `window.__BACKEND_URL__` for desktop). Until `ready === true`, the app renders `BlockingScreen` (`frontend/src/components/startup/BlockingScreen.tsx`). The screen shows the spinner, logo, and the last error string so that non-technical users still see feedback.

   ```tsx
   const { ready, error } = useBackendHealth();
   if (!ready) {
     return (
       <BlockingScreen
         title="LDaCA Corpus Analysis"
         description="Waiting for the backend API to finish booting."
         status="Starting backend services"
         hint={error ?? 'Most boots finish within 30 seconds.'}
       />
     );
   }
   ```

2. **Step 2 – Ask “Can we trust the auth session?”**  
  *Question*: *Why do we still see a blocking screen even after `/health` is green?*  
  *Answer*: `WorkspaceShell` is the **only** component that opts into `useAuth({ autoStart: true })`. Every other hook call uses the new default `autoStart: false`, meaning they simply subscribe to the shared auth snapshot without firing `/api/auth/` on mount. Once the backend gate flips to ready, `WorkspaceShell` mounts, detects that no auth info has been loaded yet, and kicks off the bootstrap fetch itself. The UI stays on `BlockingScreen` until `phase.status === 'ready'`. The Retry button still calls `refreshAuth()` (which internally forces another bootstrap), but we avoid the old behavior where sidebar/tab mounts re-triggered `/api/auth/`, tore down the workspace tree, and spammed the backend with SSE cancellations.

3. **Step 3 – When both gates pass**  
   *Question*: *What finally unlocks the workspace layout?*  
   *Answer*: Once `backendReady && !authLoading`, the normal providers render. If the backend says multi-user mode is enabled and the user is not authenticated, the Google login card is shown as before.

**Safety Net Tests**  
`frontend/src/App.startup.test.tsx` runs through the three scenarios with Vitest + Testing Library (`vite.config.ts` now sets `test.environment = 'jsdom'`). The tests mock `useAuth`/`useBackendHealth` and assert that:

- The backend gate shows “Starting backend services” alongside the last health error.
- The auth gate shows “Signing you in” whenever `useAuth().phase.status === 'bootstrapping'`; the Retry button simply calls `refreshAuth()` while the hook manages the actual bootstrap fetch.
- When both gates pass, the main layout mounts (`Sidebar`, `WorkspaceView`, etc.).

#### Auth refresh resiliency (frontend)

- `useAuth()` now boils the lifecycle down to a single `phase: AuthPhase` union plus `isLoading`/`error` shorthands. The phases are:  
  - `'bootstrapping'`: first contact (or post-fatal retry) with `/api/auth/`.  
  - `'ready'`: cached auth info is fresh; the UI renders normally.  
  - `'refreshing'`: background poll is in-flight; no UI appears unless it runs longer than 3 s.  
  - `'degraded'`: at least one refresh failed but fewer than three consecutively—LDaCA keeps using the previous token and shows a slim banner.  
  - `'fatal'`: three consecutive failures or an explicit 401/403; the blocking screen reappears until the user retries.
- The hook defaults to `autoStart: false`; `WorkspaceShell` opts in so there is exactly one bootstrap fetch per page load. This prevents child components (e.g., `Sidebar`, tabs, task streams) from re-triggering `/api/auth/`, which previously caused their React subtrees to unmount and forced the SSE connections to restart.
- Background refreshes (still every 5 minutes) run silently; if a refresh exceeds 3 s the top-center “Reconnecting…” chip fades in. The banner includes the attempt counter `X/3`, the last failure timestamp, and a “Retry now” CTA without tearing down the workspace.
- When `phase.status === 'fatal'` the blocking screen copy changes to “Reconnecting your session” with the same retry counter. Clicking *Retry* routes through `refreshAuth()`, which forces a bootstrap fetch and keeps the UI stable until `/api/auth/` succeeds again.
- `WorkspaceShell` is the only component that interprets these phases, so every route/tab inherits the same overlays with zero duplicated logic.

### Desktop Runtime + Sidecar Notes

- `backend/scripts/package_backend_runtime.py` still vendors a full Python install into `backend/dist-tauri/backend-runtime/python/`, but it now treats the bundled interpreter as the primary entrypoint. The script copies the managed `uv` toolchain, builds local wheels for `docframe`, `docworkspace`, and the backend, and installs every dependency into the copied site-packages. The legacy `run_backend.sh` launcher (plus `run_backend.sh-<target>`) is still emitted for engineers who want a one-liner to boot the backend outside the desktop app, yet the Rust host no longer depends on it.
- `locate_backend_runtime()` in `src-tauri/src/main.rs` replaces the shell sidecar lookup. It first honors `LDACA_BACKEND_RUNTIME` (preferred) and `LDACA_BACKEND_PYTHON`, falls back to the macOS bundle resource path via `app.path_resolver().resolve_resource()`, then walks upward from `current_exe()` checking the same directories as the old launcher (including `_up_` and `Resources/backend/dist-tauri/backend-runtime`). `LDACA_BACKEND_LAUNCHER` is still accepted for backwards compatibility by taking the parent folder of the provided script path.
- After the runtime root is discovered, `load_runtime_env()` uses `dotenvy` to parse `.env` and `.env.desktop`, merging those values with the ambient environment before `spawn_backend_process()` runs `python -m ldaca_web_app_backend.cli`. The helper injects `BACKEND_PORT`, `LDACA_BACKEND_PORT`, `SERVER_HOST`, `LDACA_SERVER_HOST`, `PYTHONUNBUFFERED`, `LDACA_CONFIG_PROFILE` (defaulting to `desktop`), plus the resolved `LDACA_BACKEND_RUNTIME`/`LDACA_BACKEND_PYTHON` paths. `wait_for_backend_health()` still polls `${BACKEND_URL}/health` every 500 ms, so React only mounts once FastAPI is reachable, but the intermediate logging now reflects the direct interpreter spawn instead of a shell sidecar.

### Database Queries

**Async SQLite**:
- Use connection pooling: `create_async_engine(pool_size=10)`
- Index frequently queried columns: `CREATE INDEX idx_user_email ON users(email)`
- Batch operations: `db.execute(insert(User).values([...]))` instead of multiple inserts

## Testing Strategy

### Backend Tests (`backend/tests/`)

**Structure**:
- `unit/`: Unit tests for individual functions/classes
- `integration/`: Integration tests for API endpoints
- `fixtures.py`: Shared test fixtures (mock data, test workspaces)

**Example**:
```python
@pytest.mark.integration
async def test_load_file_as_node(test_client, test_workspace, test_file):
    """Test loading file as node in workspace."""
    response = await test_client.post(
        f"/api/workspaces/{test_workspace.id}/nodes/load",
        json={"filepath": test_file, "name": "test_node"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "test_node"
    assert data["shape"][0] > 0  # Has rows
```

### Frontend Tests (`frontend/src/__tests__/`)

**Testing Library Stack**:
- `vitest`: Test runner
- `@testing-library/react`: Component testing
- `@testing-library/user-event`: User interaction simulation
- `msw` (Mock Service Worker): API mocking

**Example**:
```typescript
describe('WorkspaceGraph', () => {
  it('renders nodes and edges', async () => {
    // Mock API response
    server.use(
      http.get('/api/workspaces/:id', () => {
        return HttpResponse.json({
          nodes: [{id: 'node1', data: {label: 'Test'}}],
          edges: [],
        });
      })
    );
    
    render(<WorkspaceGraph workspaceId="workspace1" />);
    
    // Wait for nodes to render
    await waitFor(() => {
      expect(screen.getByText('Test')).toBeInTheDocument();
    });
  });
});
```

### DocWorkspace Tests (`docworkspace/tests/`)

**Coverage**:
- `test_node.py`: Node operations, relationships
- `test_workspace.py`: Workspace graph operations, serialization
- `test_fastapi_integration.py`: FastAPI model compatibility

**Example**:
```python
def test_filter_creates_parent_child_relationship(workspace, sample_df):
    """Test that filter operation creates proper parent-child relationship."""
    parent = Node(sample_df, "parent", workspace)
    child = parent.filter(pl.col("category") == "A")
    
    assert len(parent.children) == 1
    assert parent.children[0] == child
    assert len(child.parents) == 1
    assert child.parents[0] == parent
```

## Common Usage Patterns

### Pattern 1: Create Workspace and Load Data

```python
# Backend
from docworkspace import Workspace, Node
import docframe as df

workspace = Workspace("my_analysis")
data = df.read_csv("data.csv")
node = Node(data, "raw_data", workspace)
workspace.serialize("workspace.json")
```

```typescript
// Frontend
const createWorkspace = useMutation({
  mutationFn: (name) => api.createWorkspace({name}),
  onSuccess: (workspace) => {
    navigate(`/workspace/${workspace.id}`);
  },
});

const loadFile = useMutation({
  mutationFn: (params) => api.loadFileAsNode(workspaceId, params),
  onSuccess: () => {
    queryClient.invalidateQueries(['workspaceGraph', workspaceId]);
  },
});
```

### Pattern 2: Filter and Transform Data

```python
# Backend (via API endpoint)
workspace = load_workspace(user_id, workspace_id)
source_node = workspace.nodes[node_id]

# Filter operation
filtered_node = source_node.filter(pl.col("score") > 0.5)

# Select columns
subset_node = filtered_node.select(["text", "score"])

# Join with another node
other_node = workspace.nodes[other_id]
merged_node = subset_node.join(other_node, on="id")

workspace_manager.persist(user_id, workspace_id)
```

### Pattern 3: Compute Token Frequencies

```python
# Backend
from docframe.core.text_utils import compute_token_frequencies

# Get nodes from workspace
frames = {
    "corpus1": workspace.nodes[node1_id],
    "corpus2": workspace.nodes[node2_id],
}

# Compute frequencies and statistics
freq_dicts, stats_df = compute_token_frequencies(frames, stop_words=None)

# IMPORTANT: The backend now returns the entire vocabulary and only records the
# student's preferred `token_limit` in metadata. Stop words are stored so the UI
# can filter them locally without re-running the analysis.

# Store in workspace metadata
workspace.set_metadata("token_freq_analysis", {
    "frequencies": freq_dicts,
    "statistics": stats_df.to_dicts(),
})
```

```typescript
// Frontend
const tokenFreqMutation = useMutation({
  mutationFn: (params) => api.computeTokenFrequencies(workspaceId, params),
  onSuccess: (data) => {
    setAnalysisResults(data);
    setShowAnalysisPanel(true);
  },
});

// Trigger analysis (token_limit is purely a UI preference)
tokenFreqMutation.mutate({
  node_ids: selectedNodes,
  column: 'document',
  token_limit: 100,
});
```

### Pattern 4: Visualize Workspace Graph

```typescript
// Frontend
const {data: graph, isLoading} = useQuery({
  queryKey: ['workspaceGraph', workspaceId],
  queryFn: () => api.getWorkspace(workspaceId),
});

return (
  <ReactFlow
    nodes={graph.nodes}
    edges={graph.edges}
    nodeTypes={{customNode: CustomNode}}
    onNodeClick={(event, node) => {
      setSelectedNodes([node.id]);
    }}
    fitView
  />
);
```

## Troubleshooting Guide

### Issue: Workspace not persisting changes

**Cause**: `WorkspaceManager.persist()` not called after modifications  
**Solution**: Always call `workspace_manager.persist(user_id, workspace_id)` after workspace changes in endpoints

### Issue: Frontend shows stale data after API call

**Cause**: TanStack Query cache not invalidated  
**Solution**: Call `queryClient.invalidateQueries()` with correct query key after mutations

**Example**:
```typescript
onSuccess: () => {
  queryClient.invalidateQueries(['workspaceGraph', workspaceId]);
  queryClient.invalidateQueries(['node', workspaceId, nodeId]);
}
```

### Issue: Node operations fail with "Node not in workspace"

**Cause**: Node removed from workspace or workspace not loaded correctly  
**Solution**: Verify workspace loaded before accessing nodes; check `node.id in workspace.nodes`

### Issue: Large datasets slow down frontend

**Cause**: Attempting to render entire dataset in browser  
**Solution**: Use pagination via `GET /api/workspaces/{workspace_id}/nodes/{node_id}/data?page=1&page_size=100`

### Issue: Authentication fails in single-user mode

**Cause**: `MULTI_USER` environment variable set incorrectly  
**Solution**: Set `MULTI_USER=false` in backend `.env` file

### Issue: CORS errors in development

**Cause**: Backend CORS not configured for frontend origin  
**Solution**: Add frontend URL to `CORS_ALLOWED_ORIGINS_STR` in backend `.env`:
```
CORS_ALLOWED_ORIGINS_STR=http://localhost:3000,http://localhost:5173
```

## Future Extension Opportunities

1. **Real-Time Collaboration**: WebSocket support for multi-user workspaces
2. **Workspace Sharing**: Share workspaces between users with permission levels
3. **Advanced Visualizations**: Interactive charts, network graphs, geographic maps
4. **Export Options**: Export workspaces as notebooks, scripts, or reports
5. **Plugin System**: Allow custom analysis plugins via dynamic loading
6. **Cloud Storage**: S3/GCS backend for large datasets
7. **Distributed Computing**: Spark/Dask integration for large-scale processing
8. **Version Control**: Git-like versioning for workspace history

## Conclusion

The LDaCA Web App architecture emphasizes:

- **Separation of Concerns**: DocWorkspace (graph), Backend (API), Frontend (UI) are independent modules
- **Data Lineage**: Parent-child relationships enable full traceability of transformations
- **Lazy Evaluation**: Polars LazyFrames optimize performance by deferring execution
- **Type Safety**: TypeScript frontend, Pydantic backend, strict validation throughout
- **Extensibility**: Modular routers, pluggable analysis methods, custom node types

AI tools and developers can leverage this architecture by:

- Using **DocWorkspace** for graph-based data management in Python applications
- Extending **Backend routers** to add custom analysis endpoints
- Creating **Frontend components** for new visualization types
- Implementing **custom Node operations** for domain-specific transformations
- Integrating **external libraries** (spaCy, sklearn, etc.) via analysis modules
