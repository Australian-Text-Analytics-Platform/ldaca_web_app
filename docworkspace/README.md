# DocWorkspace

A powerful Python library for managing DataFrames and DocDataFrames with parent-child relationships, lazy evaluation, and FastAPI integration. Part of the LDaCA (Language Data Commons of Australia) ecosystem.

## Overview

DocWorkspace provides a workspace-based approach to data analysis, where data transformations are tracked as nodes in a directed graph. This enables:

- **Relationship Tracking**: Understand data lineage and transformation history
- **Lazy Evaluation**: Optimize performance with Polars LazyFrames
- **Multiple Data Types**: Support for Polars DataFrames, LazyFrames, DocDataFrames, and DocLazyFrames
- **FastAPI Integration**: Ready-to-use models and utilities for web APIs
- **Serialization**: Save and restore entire workspaces with their relationships

## Installation

```bash
pip install docworkspace
```

### Dependencies

- Python ≥ 3.12
- polars ≥ 0.20.0
- docframe
- pandas ≥ 2.0.0
- typing-extensions

For FastAPI integration:
```bash
pip install pydantic
```

## Quick Start

```python
import polars as pl
from docworkspace import Node, Workspace
from docframe import DocDataFrame

# Create a workspace
workspace = Workspace("my_analysis")

# Load data
df = pl.DataFrame({
    "text": ["Hello world", "Data science", "Python rocks"],
    "category": ["greeting", "tech", "programming"],
    "score": [0.8, 0.9, 0.95]
})

# Add data to workspace
data_node = workspace.add_node(Node(df, name="raw_data"))

# Apply transformations (creates new nodes automatically)
filtered = data_node.filter(pl.col("score") > 0.85)
grouped = filtered.group_by("category").agg(pl.col("score").mean())

# Check relationships
print(f"Total nodes: {len(workspace.nodes)}")
print(f"Root nodes: {len(workspace.get_root_nodes())}")
print(f"Leaf nodes: {len(workspace.get_leaf_nodes())}")

# Visualize the computation graph
print(workspace.visualize_graph())
```

## Core Concepts

### Node

A `Node` wraps your data (DataFrames, LazyFrames, DocDataFrames) and tracks relationships with other nodes. Nodes support:

- **Transparent Data Access**: All DataFrame methods work directly on nodes
- **Automatic Relationship Tracking**: Operations create child nodes
- **Lazy Evaluation**: Maintains laziness for performance
- **Metadata**: Store operation descriptions and custom metadata

```python
# Node automatically creates workspace if none provided
node = Node(df, name="my_data")

# All DataFrame operations work directly
filtered_node = node.filter(pl.col("value") > 10)
sorted_node = filtered_node.sort("value", descending=True)

# Check relationships
print(f"Children of original node: {len(node.children)}")
print(f"Parents of sorted node: {len(sorted_node.parents)}")
```

### Workspace

A `Workspace` manages collections of nodes and provides graph operations:

- **Node Management**: Add, remove, and retrieve nodes
- **Graph Operations**: Find roots, leaves, descendants, ancestors
- **Serialization**: Save/load entire workspaces
- **Visualization**: Generate text-based and programmatic graph representations

```python
workspace = Workspace("analysis")

# Add nodes
node1 = workspace.add_node(Node(df1, "dataset1"))
node2 = workspace.add_node(Node(df2, "dataset2"))

# Join creates a new node with both parents
joined = node1.join(node2, on="id")

# Explore the graph
roots = workspace.get_root_nodes()
leaves = workspace.get_leaf_nodes()
```

## Supported Data Types

DocWorkspace supports multiple data types from the Polars and DocFrame ecosystems:

### Polars Types
- **`pl.DataFrame`**: Materialized, in-memory data
- **`pl.LazyFrame`**: Lazy evaluation for performance optimization

### DocFrame Types  
- **`DocDataFrame`**: Enhanced DataFrame for text analysis with document tracking
- **`DocLazyFrame`**: Lazy version of DocDataFrame

### Example with Different Types

```python
import polars as pl
from docframe import DocDataFrame, DocLazyFrame

# Polars DataFrame (eager)
df = pl.DataFrame({"text": ["hello", "world"], "id": [1, 2]})
node1 = Node(df, "eager_data")

# Polars LazyFrame (lazy)
lazy_df = pl.LazyFrame({"text": ["foo", "bar"], "id": [3, 4]})
node2 = Node(lazy_df, "lazy_data")

# DocDataFrame (eager, with document column)
doc_df = DocDataFrame(df, document_column="text")
node3 = Node(doc_df, "doc_data")

# DocLazyFrame (lazy, with document column)
doc_lazy = DocLazyFrame(lazy_df, document_column="text") 
node4 = Node(doc_lazy, "doc_lazy_data")

# All work seamlessly in the same workspace
workspace = Workspace("mixed_types")
for node in [node1, node2, node3, node4]:
    workspace.add_node(node)
```

## Key Features

### 1. Lazy Evaluation

DocWorkspace preserves Polars' lazy evaluation capabilities:

```python
# Start with lazy data
lazy_df = pl.scan_csv("large_file.csv")
node = Node(lazy_df, "raw_data")

# Chain operations (all remain lazy)
filtered = node.filter(pl.col("value") > 100)
grouped = filtered.group_by("category").agg(pl.col("value").sum())
sorted_result = grouped.sort("value", descending=True)

# Only materialize when needed
final_result = sorted_result.collect()  # This creates a new materialized node
```

### 2. Relationship Tracking

Understand your data lineage:

```python
# Create a processing pipeline
raw_data = Node(df, "raw")
cleaned = raw_data.filter(pl.col("value").is_not_null())
normalized = cleaned.with_columns(pl.col("value") / pl.col("value").max())
final = normalized.select(["id", "normalized_value"])

# Explore relationships
print("Processing chain:")
current = final
while current.parents:
    parent = current.parents[0]
    print(f"{parent.name} -> {current.name} ({current.operation})")
    current = parent
```

### 3. FastAPI Integration

Ready-to-use models for web APIs:

```python
from docworkspace import FastAPIUtils, WorkspaceGraph, NodeSummary

# Convert workspace to FastAPI-compatible format
graph_data = workspace.to_api_graph()

# Get node summaries
summaries = [FastAPIUtils.node_to_summary(node) for node in workspace.nodes.values()]

# Get paginated data
paginated = FastAPIUtils.get_paginated_data(node, page=1, page_size=100)
```

### 4. Serialization

Save and restore complete workspaces:

```python
# Save workspace with all nodes and relationships
workspace.serialize("my_workspace.json")

# Load workspace later
restored_workspace = Workspace.deserialize("my_workspace.json")

# All nodes and relationships are preserved
assert len(restored_workspace.nodes) == len(workspace.nodes)
```

## Advanced Usage

### Custom Operations

Create custom operations that maintain relationships:

```python
def custom_transform(node: Node, operation_name: str) -> Node:
    """Apply custom transformation and track the operation."""
    # Your custom logic here
    result_data = node.data.with_columns(pl.col("value") * 2)
    
    # Create new node with relationship tracking
    return Node(
        data=result_data,
        name=f"{operation_name}_{node.name}",
        workspace=node.workspace,
        parents=[node],
        operation=operation_name
    )

# Use custom operation
transformed = custom_transform(original_node, "double_values")
```

### Graph Analysis

Analyze your computation graph:

```python
# Find all descendants of a node
descendants = workspace.get_descendants(node.id)

# Find all ancestors
ancestors = workspace.get_ancestors(node.id)

# Get topological ordering
ordered_nodes = workspace.get_topological_order()

# Check for cycles (shouldn't happen in normal usage)
has_cycles = workspace.has_cycles()
```

### Working with DocDataFrames

Enhanced text analysis capabilities:

```python
from docframe import DocDataFrame

# Create DocDataFrame with document column
df = pl.DataFrame({
    "doc_id": ["d1", "d2", "d3"],
    "text": ["Hello world", "Data science", "Python rocks"],
    "metadata": ["type1", "type2", "type1"]
})

doc_df = DocDataFrame(df, document_column="text")
node = Node(doc_df, "corpus")

# DocDataFrame operations work seamlessly
filtered = node.filter(pl.col("metadata") == "type1")
print(f"Document column preserved: {filtered.data.document_column}")
```

## API Reference

### Node Class

#### Constructor
```python
Node(data, name=None, workspace=None, parents=None, operation=None)
```

#### Properties
- `is_lazy: bool` - Whether the underlying data is lazy
- `document_column: Optional[str]` - Document column for DocDataFrames

#### Methods
- `collect() -> Node` - Materialize lazy data (creates new node)
- `materialize() -> Node` - Alias for collect()
- `info(json=False) -> Dict` - Get node information
- `json_schema() -> Dict[str, str]` - Get JSON-compatible schema

#### DataFrame Operations
All Polars DataFrame/LazyFrame operations are available directly:
- `filter(condition) -> Node`
- `select(columns) -> Node`
- `with_columns(*exprs) -> Node`
- `group_by(*columns) -> Node`
- `sort(by, descending=False) -> Node`
- `join(other, on, how="inner") -> Node`
- And many more...

### Workspace Class

#### Constructor
```python
Workspace(name=None, data=None, data_name=None, csv_lazy=True, **csv_kwargs)
```

#### Properties
- `id: str` - Unique workspace identifier
- `name: str` - Human-readable name
- `nodes: Dict[str, Node]` - All nodes in the workspace

#### Methods

##### Node Management
- `add_node(node) -> Node` - Add a node to the workspace
- `remove_node(node_id, materialize_children=False) -> bool` - Remove a node
- `get_node(node_id) -> Optional[Node]` - Get node by ID
- `get_node_by_name(name) -> Optional[Node]` - Get node by name
- `list_nodes() -> List[Node]` - Get all nodes

##### Graph Operations
- `get_root_nodes() -> List[Node]` - Nodes with no parents
- `get_leaf_nodes() -> List[Node]` - Nodes with no children
- `get_descendants(node_id) -> List[Node]` - All descendant nodes
- `get_ancestors(node_id) -> List[Node]` - All ancestor nodes
- `get_topological_order() -> List[Node]` - Topologically sorted nodes

##### Visualization
- `visualize_graph() -> str` - Text-based graph visualization
- `graph() -> Dict` - Generic graph structure
- `to_react_flow_json() -> Dict` - React Flow compatible format

##### Serialization
- `serialize(file_path)` - Save workspace to JSON
- `deserialize(file_path) -> Workspace` - Load workspace from JSON
- `from_dict(workspace_dict) -> Workspace` - Create from dictionary

##### Metadata
- `get_metadata(key) -> Any` - Get workspace metadata
- `set_metadata(key, value)` - Set workspace metadata
- `summary() -> Dict` - Get workspace summary
- `info() -> Dict` - Alias for summary()

### FastAPI Integration

#### Models
- `NodeSummary` - API-friendly node representation
- `WorkspaceGraph` - React Flow compatible graph
- `PaginatedData` - Paginated data response
- `ErrorResponse` - Standard error format
- `OperationResult` - Operation result wrapper

#### Utilities
```python
FastAPIUtils.node_to_summary(node) -> NodeSummary
FastAPIUtils.get_paginated_data(node, page=1, page_size=100) -> PaginatedData
FastAPIUtils.workspace_to_react_flow(workspace) -> WorkspaceGraph
```

## Examples

### Example 1: Text Analysis Pipeline

```python
import polars as pl
from docworkspace import Node, Workspace
from docframe import DocDataFrame

# Sample text data
df = pl.DataFrame({
    "doc_id": [f"doc_{i}" for i in range(100)],
    "text": [f"Sample text content {i}" for i in range(100)],
    "category": ["news", "blog", "academic"] * 34,
    "year": [2020, 2021, 2022, 2023] * 25
})

# Create workspace
workspace = Workspace("text_analysis")

# Load as DocDataFrame for text analysis
doc_df = DocDataFrame(df, document_column="text")
corpus = workspace.add_node(Node(doc_df, "full_corpus"))

# Filter by category
news_docs = corpus.filter(pl.col("category") == "news")
blog_docs = corpus.filter(pl.col("category") == "blog")

# Filter by recent years
recent_news = news_docs.filter(pl.col("year") >= 2022)

# Group analysis
year_stats = corpus.group_by(["category", "year"]).agg(
    pl.count().alias("doc_count")
)

# Materialize results
final_stats = year_stats.collect()

# Analyze the computation graph
print(workspace.visualize_graph())
print(f"Total transformations: {len(workspace.nodes)}")
```

### Example 2: Lazy Data Processing

```python
import polars as pl
from docworkspace import Workspace

# Create workspace with lazy CSV loading
workspace = Workspace(
    "large_data_analysis",
    data="large_dataset.csv",  # Path to CSV
    data_name="raw_data",
    csv_lazy=True  # Load as LazyFrame for performance
)

# Get the loaded node
raw_data = workspace.get_node_by_name("raw_data")
print(f"Is lazy: {raw_data.is_lazy}")  # True

# Chain transformations (all remain lazy)
cleaned = raw_data.filter(pl.col("value").is_not_null())
normalized = cleaned.with_columns(
    (pl.col("value") / pl.col("value").max()).alias("normalized")
)
aggregated = normalized.group_by("category").agg([
    pl.col("normalized").mean().alias("avg_normalized"),
    pl.count().alias("count")
])

# Still lazy until we collect
print(f"Aggregated is lazy: {aggregated.is_lazy}")  # True

# Materialize only the final result
result = aggregated.collect()
print(f"Result is lazy: {result.is_lazy}")  # False

# Save the entire workspace with lazy evaluation preserved
workspace.serialize("lazy_analysis.json")
```

### Example 3: Multi-Source Data Integration

```python
import polars as pl
from docworkspace import Node, Workspace

workspace = Workspace("data_integration")

# Load data from multiple sources
sales_df = pl.DataFrame({
    "customer_id": [1, 2, 3, 4],
    "sales": [100, 200, 150, 300],
    "region": ["North", "South", "East", "West"]
})

customer_df = pl.DataFrame({
    "customer_id": [1, 2, 3, 4, 5],
    "name": ["Alice", "Bob", "Charlie", "Diana", "Eve"],
    "segment": ["Premium", "Regular", "Premium", "Regular", "Premium"]
})

# Add to workspace
sales_node = workspace.add_node(Node(sales_df, "sales_data"))
customer_node = workspace.add_node(Node(customer_df, "customer_data"))

# Join the datasets
combined = sales_node.join(customer_node, on="customer_id", how="inner")

# Analyze by segment
segment_analysis = combined.group_by("segment").agg([
    pl.col("sales").sum().alias("total_sales"),
    pl.col("sales").mean().alias("avg_sales"),
    pl.count().alias("customer_count")
])

# Filter high-value segments
high_value = segment_analysis.filter(pl.col("total_sales") > 200)

print(f"Nodes in workspace: {len(workspace.nodes)}")
print("Data lineage:")
for node in workspace.get_leaf_nodes():
    print(f"Leaf node: {node.name}")
```

## Development

### Running Tests

```bash
# Install development dependencies
pip install pytest

# Run all tests
pytest

# Run with coverage
pytest --cov=docworkspace

# Run specific test file
pytest tests/test_workspace.py -v
```

### Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and add tests
4. Run the test suite: `pytest`
5. Submit a pull request

### Project Structure

```
docworkspace/
├── docworkspace/           # Main package
│   ├── __init__.py        # Package exports
│   ├── node.py            # Node class implementation
│   ├── workspace.py       # Workspace class implementation
│   ├── api_models.py      # FastAPI Pydantic models
│   └── api_utils.py       # FastAPI utility functions
├── tests/                 # Test suite
│   ├── test_node.py       # Node class tests
│   ├── test_workspace.py  # Workspace class tests
│   ├── test_integration.py # Integration tests
│   └── test_coverage.py   # Coverage tests
├── examples/              # Example scripts and data
├── README.md             # This file
└── pyproject.toml        # Project configuration
```

## License

Part of the LDaCA (Language Data Commons of Australia) ecosystem.

## Changelog

### Version 0.1.0
- Initial release
- Core Node and Workspace functionality
- Support for Polars and DocFrame data types
- Lazy evaluation support
- FastAPI integration
- Serialization capabilities
- Comprehensive test suite

## Related Projects

- **[DocFrame](https://github.com/ldaca/docframe)**: Enhanced DataFrames for text analysis
- **[LDaCA Web App](https://github.com/ldaca/ldaca_web_app)**: Full-stack web application using DocWorkspace
- **[Polars](https://pola.rs/)**: Fast DataFrame library with lazy evaluation
