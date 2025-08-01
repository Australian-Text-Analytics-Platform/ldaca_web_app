"""
Core utilities for the LDaCA Web App
"""

import shutil
import uuid
from pathlib import Path
from typing import Any, Dict, Union

import pandas as pd
import polars as pl

# Import optional dependencies
try:
    import docframe
    from docframe import DocDataFrame, DocLazyFrame

    DOCFRAME_AVAILABLE = True
except ImportError:
    DOCFRAME_AVAILABLE = False

try:
    from docworkspace import Node, Workspace

    DOCWORKSPACE_AVAILABLE = True
except ImportError:
    DOCWORKSPACE_AVAILABLE = False

    # Create dummy classes for type hints
    class Workspace:
        pass

    class Node:
        pass


from config import config


def get_user_data_folder(user_id: str) -> Path:
    """Get user-specific data folder with proper structure"""
    # In single-user mode, always use 'user_root' folder
    if not config.multi_user:
        folder_name = "user_root"
    else:
        folder_name = f"user_{user_id}"

    user_folder = Path(config.user_data_folder) / folder_name
    user_data_folder = user_folder / "user_data"
    user_data_folder.mkdir(parents=True, exist_ok=True)
    return user_data_folder


def get_user_workspace_folder(user_id: str) -> Path:
    """Get user-specific workspace folder"""
    # In single-user mode, always use 'user_root' folder
    if not config.multi_user:
        folder_name = "user_root"
    else:
        folder_name = f"user_{user_id}"

    user_folder = Path(config.user_data_folder) / folder_name
    workspace_folder = user_folder / "user_workspaces"
    workspace_folder.mkdir(parents=True, exist_ok=True)
    return workspace_folder


def setup_user_folders(user_id: str) -> Dict[str, Path]:
    """Set up complete user folder structure and copy sample data"""
    # In single-user mode, always use 'user_root' folder
    if not config.multi_user:
        folder_name = "user_root"
    else:
        folder_name = f"user_{user_id}"

    user_folder = Path(config.user_data_folder) / folder_name
    user_data_folder = user_folder / "user_data"
    user_workspaces_folder = user_folder / "user_workspaces"

    # Create the main folders
    user_data_folder.mkdir(parents=True, exist_ok=True)
    user_workspaces_folder.mkdir(parents=True, exist_ok=True)

    # Copy/reset sample_data into user_data
    copy_sample_data_to_user(user_id)

    return {
        "user_folder": user_folder,
        "user_data": user_data_folder,
        "user_workspaces": user_workspaces_folder,
    }


def copy_sample_data_to_user(user_id: str) -> None:
    """Copy sample_data folder into user's data folder, resetting if it exists"""
    source_sample_data = Path(config.sample_data_folder)
    user_data_folder = get_user_data_folder(user_id)
    target_sample_data = user_data_folder / "sample_data"

    # If sample data exists in user folder, remove it first (reset)
    if target_sample_data.exists():
        shutil.rmtree(target_sample_data)

    # Copy the sample data if source exists
    if source_sample_data.exists():
        shutil.copytree(source_sample_data, target_sample_data)
        print(f"✅ Sample data copied to user {user_id} data folder")
    else:
        print(f"⚠️ No sample_data folder found at {source_sample_data}")


def get_file_size_mb(file_path: Path) -> float:
    """Get file size in MB"""
    return file_path.stat().st_size / (1024 * 1024) if file_path.exists() else 0.0


def get_folder_size_mb(folder_path: Path) -> float:
    """Get total size of folder in MB"""
    total_size = 0
    for file_path in folder_path.rglob("*"):
        if file_path.is_file():
            total_size += file_path.stat().st_size
    return total_size / (1024 * 1024)


def detect_file_type(filename: str) -> str:
    """Detect file type from extension"""
    ext = Path(filename).suffix.lower()
    type_map = {
        ".csv": "csv",
        ".json": "json",
        ".jsonl": "jsonl",
        ".parquet": "parquet",
        ".xlsx": "excel",
        ".txt": "text",
        ".tsv": "tsv",
    }
    return type_map.get(ext, "unknown")


def load_data_file(
    file_path: Path,
) -> Union[pl.DataFrame, pl.LazyFrame, pd.DataFrame, Any]:
    """Load data file into appropriate DataFrame type - defaults to polars LazyFrame for efficiency"""
    file_type = detect_file_type(file_path.name)

    # Load as polars LazyFrame by default for better performance and memory efficiency
    try:
        import polars as pl

        if file_type == "csv":
            return pl.scan_csv(file_path)
        elif file_type == "parquet":
            return pl.scan_parquet(file_path)
        elif file_type == "json":
            # JSON doesn't have scan_json, fall back to read_json
            return pl.read_json(file_path)
        elif file_type == "tsv":
            return pl.scan_csv(file_path, separator="\t")
    except Exception as e:
        print(f"Warning: polars lazy loading failed: {e}, falling back to pandas")

    # Fallback to pandas
    if file_type == "csv":
        return pd.read_csv(file_path)
    elif file_type == "json":
        return pd.read_json(file_path)
    elif file_type == "parquet":
        return pd.read_parquet(file_path)
    elif file_type == "excel":
        return pd.read_excel(file_path)
    elif file_type == "tsv":
        return pd.read_csv(file_path, sep="\t")
    else:
        raise ValueError(f"Unsupported file type: {file_type}")


def serialize_dataframe_for_json(df) -> Dict[str, Any]:
    """
    Convert a DataFrame (pandas, polars, or DocDataFrame) to JSON-serializable format
    with complete type representation using module.ClassName format.
    """
    try:
        if df is None:
            return {
                "shape": (0, 0),
                "columns": [],
                "dtypes": {},
                "preview": [],
                "is_text_data": False,
                "data_type": f"{type(None).__module__}.{type(None).__name__}",
                "is_lazy": False,
            }

        # Extract underlying data if this is wrapped in docworkspace.Node
        underlying_data = df
        is_doc_type = False
        doc_column = None
        is_lazy = False

        # Handle docworkspace.Node wrapper
        if hasattr(df, "data") and hasattr(df, "name") and hasattr(df, "id"):
            # This is likely an docworkspace.Node - extract the underlying data
            underlying_data = df.data
            # Use the Node's is_lazy property if available
            if hasattr(df, "is_lazy"):
                is_lazy = df.is_lazy
            else:
                # Fallback: check if underlying data is LazyFrame
                if hasattr(underlying_data, "__class__"):
                    underlying_type_name = underlying_data.__class__.__name__
                    if "Lazy" in underlying_type_name:
                        is_lazy = True
            print(
                f"DEBUG: Extracted data from docworkspace.Node, underlying type: {type(underlying_data)}, is_lazy: {is_lazy}"
            )

        # Extract underlying polars data if this is a DocDataFrame or DocLazyFrame
        if hasattr(underlying_data, "dataframe"):
            # This is a DocDataFrame - get underlying polars DataFrame
            underlying_data = underlying_data.dataframe
            is_doc_type = True
            doc_column = getattr(df, "active_document_name", None)
            print("DEBUG: Extracted polars DataFrame from DocDataFrame")
        elif hasattr(underlying_data, "lazyframe"):
            # This is a DocLazyFrame - get underlying polars LazyFrame
            underlying_data = underlying_data.lazyframe
            is_doc_type = True
            is_lazy = True  # DocLazyFrame is always lazy
            doc_column = getattr(df, "active_document_name", None)
            print("DEBUG: Extracted polars LazyFrame from DocLazyFrame")

        # Now handle the underlying data uniformly
        # Handle shape - LazyFrames don't have a shape until collected
        if hasattr(underlying_data, "shape"):
            shape = underlying_data.shape
            print(f"DEBUG: Got shape from .shape property: {shape}")
        elif hasattr(underlying_data, "collect_schema"):
            # LazyFrame - we can get column count from schema and row count from .select(pl.len()).collect()
            print("DEBUG: Processing LazyFrame shape calculation")
            try:
                schema = underlying_data.collect_schema()
                col_count = len(schema)
                print(f"DEBUG: Got column count from schema: {col_count}")

                # Get row count by collecting length
                try:
                    row_count = underlying_data.select(pl.len()).collect().item()
                    shape = (row_count, col_count)
                    print(f"DEBUG: Successfully calculated LazyFrame shape: {shape}")
                except Exception as e:
                    print(f"Warning: Could not get LazyFrame row count: {e}")
                    shape = (
                        0,
                        col_count,
                    )  # Row count unknown for lazy, but we have columns
            except Exception as e:
                print(f"Warning: Could not get LazyFrame schema: {e}")
                shape = (0, 0)
        else:
            shape = (0, 0)
            print(
                "DEBUG: No shape or collect_schema method found, defaulting to (0, 0)"
            )

        # Handle columns - use collect_schema for LazyFrames to avoid performance warnings
        if hasattr(underlying_data, "collect_schema"):
            # LazyFrame
            try:
                schema = underlying_data.collect_schema()
                columns = list(schema.names())
            except Exception as e:
                print(f"Warning: Could not get LazyFrame columns: {e}")
                columns = []
        elif hasattr(underlying_data, "columns"):
            columns = list(underlying_data.columns)
        else:
            columns = []

        # Get dtypes - use collect_schema for LazyFrames
        dtypes = {}
        if hasattr(underlying_data, "collect_schema"):
            # LazyFrame
            try:
                schema = underlying_data.collect_schema()
                dtypes = {col: str(dtype) for col, dtype in schema.items()}
            except Exception as e:
                print(f"Warning: Could not get LazyFrame dtypes: {e}")
                dtypes = {}
        elif hasattr(underlying_data, "schema"):
            # Regular polars DataFrame
            dtypes = {col: str(dtype) for col, dtype in underlying_data.schema.items()}
        elif hasattr(underlying_data, "dtypes"):
            # Pandas
            dtypes = {col: str(dtype) for col, dtype in underlying_data.dtypes.items()}

        # Get preview data - collect LazyFrame for preview
        preview = []
        if hasattr(underlying_data, "head"):
            try:
                # Check if it's a LazyFrame by checking for collect method
                if hasattr(underlying_data, "collect") and hasattr(
                    underlying_data, "collect_schema"
                ):
                    # LazyFrame - collect first 5 rows
                    preview_df = underlying_data.head(5).collect()
                else:
                    # Regular DataFrame
                    preview_df = underlying_data.head(5)

                # Convert to pandas for consistent JSON serialization
                if hasattr(preview_df, "to_pandas"):
                    preview_pandas = preview_df.to_pandas()
                else:
                    preview_pandas = preview_df

                # Handle NaN values safely - check if it's a pandas DataFrame
                try:
                    if hasattr(preview_pandas, "fillna"):
                        preview = preview_pandas.fillna("None").to_dict(
                            orient="records"
                        )
                    else:
                        # For non-pandas DataFrames, just convert directly
                        preview = (
                            preview_pandas.to_dict()
                            if hasattr(preview_pandas, "to_dict")
                            else []
                        )
                except Exception as e:
                    print(f"Warning: Could not convert preview to dict: {e}")
                    preview = []
            except Exception as e:
                print(f"Error getting preview: {e}")
                preview = []

        # Use the most complete data type representation: module.ClassName
        underlying_type = type(underlying_data)
        data_type_clean = f"{underlying_type.__module__}.{underlying_type.__name__}"

        # For special handling of DocDataFrame and other custom types,
        # we still use the underlying data but show the complete path
        if is_doc_type:
            # For DocDataFrame, show the wrapper type but with complete module path
            wrapper_type = type(df)
            data_type_clean = f"{wrapper_type.__module__}.{wrapper_type.__name__}"

        result = {
            "shape": shape,
            "columns": columns,
            "dtypes": dtypes,
            "preview": preview,
            "is_text_data": is_doc_type,
            "data_type": data_type_clean,
            "is_lazy": is_lazy or "LazyFrame" in data_type_clean,
        }

        # Add document column info for DocDataFrame
        if is_doc_type and doc_column:
            result["document_column"] = doc_column

        return result

    except Exception as e:
        print(f"Error processing DataFrame: {e}")
        # Fallback to basic info with complete type representation
        fallback_type = type(df) if df is not None else type(None)
        # Initialize variables that might not be set
        is_doc_type = getattr(df, "__doc_type__", False) if df is not None else False
        is_lazy = False
        return {
            "shape": (0, 0),
            "columns": [],
            "dtypes": {},
            "preview": [],
            "is_text_data": is_doc_type,
            "data_type": f"{fallback_type.__module__}.{fallback_type.__name__}",
            "is_lazy": is_lazy,
        }


def generate_node_id() -> str:
    """Generate a unique node ID"""
    return str(uuid.uuid4())


def generate_workspace_id() -> str:
    """Generate a unique workspace ID"""
    return str(uuid.uuid4())


def validate_file_path(file_path: Path, user_folder: Path) -> bool:
    """Validate that file path is within user's allowed directory"""
    try:
        file_path.resolve().relative_to(user_folder.resolve())
        return True
    except ValueError:
        return False


def convert_to_react_flow_graph(generic_graph: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert generic graph structure to React Flow compatible format.

    Args:
        generic_graph: Generic graph structure from docworkspace

    Returns:
        React Flow compatible graph structure
    """
    react_flow_nodes = []
    react_flow_edges = []

    nodes_data = generic_graph.get("nodes", [])
    edges_data = generic_graph.get("edges", [])
    workspace_info = generic_graph.get("workspace_info", {})

    # Generate grid layout positions
    grid_size = int(len(nodes_data) ** 0.5) + 1 if nodes_data else 1

    for i, node_data in enumerate(nodes_data):
        # Calculate position in grid
        x = (i % grid_size) * 250  # 250px spacing
        y = (i // grid_size) * 150  # 150px vertical spacing

        # Format shape information for display
        shape_display = ""
        if node_data.get("shape_info"):
            shape_info = node_data["shape_info"]
            if shape_info["type"] == "shape":
                shape_display = f" ({shape_info['rows']}×{shape_info['columns']})"
            elif shape_info["type"] == "length":
                shape_display = f" (len: {shape_info['length']})"

        # Determine node type based on relationships
        node_type = "default"
        if node_data.get("is_root"):
            node_type = "input"
        elif node_data.get("is_leaf"):
            node_type = "output"

        # Create React Flow node
        react_flow_node = {
            "id": node_data["id"],
            "type": node_type,
            "position": {"x": x, "y": y},
            "data": {
                "label": f"{node_data['name']}{shape_display}",
                "nodeId": node_data["id"],
                "nodeName": node_data["name"],
                "dataType": _map_workspace_type_to_display_type(
                    node_data.get("type", "unknown"), node_data.get("lazy", False)
                ),
                "status": node_data.get("status", "ready"),
                "operation": node_data.get("operation", "unknown"),
                "parentCount": node_data.get("parent_count", 0),
                "childCount": node_data.get("child_count", 0),
                "isLazy": node_data.get("lazy", False),
                "shape_info": node_data.get(
                    "shape_info"
                ),  # Preserve shape_info for frontend
            },
            "style": {
                "background": _get_node_color_by_type(
                    _map_workspace_type_to_display_type(
                        node_data.get("type", "unknown"), node_data.get("lazy", False)
                    )
                ),
                "border": "2px solid #222",
                "borderRadius": "8px",
                "padding": "10px",
                "fontSize": "12px",
            },
        }

        # Override background for special node types
        if node_data.get("is_root"):
            react_flow_node["style"]["background"] = "#e8f5e8"  # Light green for root
        elif node_data.get("is_leaf"):
            react_flow_node["style"]["background"] = "#f5e8e8"  # Light red for leaf

        react_flow_nodes.append(react_flow_node)

    # Convert edges
    for edge_data in edges_data:
        react_flow_edge = {
            "id": edge_data["id"],
            "source": edge_data["source"],
            "target": edge_data["target"],
            "type": "smoothstep",
            "animated": edge_data.get("is_lazy", False),
            "style": {"stroke": "#888", "strokeWidth": 2},
            "markerEnd": {"type": "arrow", "color": "#888"},
            "data": {"operation": edge_data.get("operation", "relationship")},
        }
        react_flow_edges.append(react_flow_edge)

    return {
        "nodes": react_flow_nodes,
        "edges": react_flow_edges,
        "workspace_info": workspace_info,
    }


def _map_workspace_type_to_display_type(workspace_type: str, is_lazy: bool) -> str:
    """
    Map workspace node type to display type for frontend.

    Args:
        workspace_type: The type from workspace node (e.g., 'DataFrame', 'DocDataFrame')
        is_lazy: Whether the node is lazy

    Returns:
        Display type string for frontend
    """
    if workspace_type == "DataFrame":
        if is_lazy:
            return "polars.LazyFrame"
        else:
            return "polars.DataFrame"
    elif workspace_type == "LazyFrame":
        return "polars.LazyFrame"
    elif workspace_type == "DocDataFrame":
        return "docframe.DocDataFrame"
    elif workspace_type == "DocLazyFrame":
        return "docframe.DocLazyFrame"
    elif workspace_type == "Series":
        return "polars.Series"
    else:
        return workspace_type


def _get_node_color_by_type(data_type: str) -> str:
    """
    Get color for a node based on its data type.

    Args:
        data_type: The data type name

    Returns:
        Hex color string
    """
    # Color based on data type
    if "DataFrame" in data_type:
        if "Doc" in data_type:
            return "#fff2cc"  # Yellow for DocDataFrame
        elif "polars" in data_type.lower() or "pl." in data_type:
            return "#d4e6f1"  # Light blue for Polars
        else:
            return "#e8f4fd"  # Light blue for pandas
    elif "Series" in data_type:
        return "#f0e8ff"  # Light purple for Series
    elif "LazyFrame" in data_type:
        if "Doc" in data_type:
            return "#ffd2a6"  # Light orange-yellow for DocLazyFrame
        else:
            return "#ffe8cc"  # Light orange for LazyFrame (lazy evaluation)
    else:
        return "#f5f5f5"  # Light gray for other types
