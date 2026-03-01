"""DocWorkspace data-type and schema conversion utilities for FastAPI."""

from dataclasses import dataclass
from typing import Any, List

import polars as pl

# Import API models
from .api_models import ColumnSchema


@dataclass(frozen=True)
class Annotation:
    """Semantic annotation value stored in annotation-typed columns."""

    provider: str
    annotation: str


ANNOTATION_POLARS_DTYPE = pl.List(
    pl.Struct([
        pl.Field("provider", pl.Utf8),
        pl.Field("annotation", pl.Utf8),
    ])
)


class DocWorkspaceDataTypeUtils:
    """Utilities for DocWorkspace dtype mapping and schema serialization."""

    @staticmethod
    def polars_dtype_to_ldaca_dtype(polars_dtype: pl.DataType) -> str:
        """Convert Polars dtype into LDaCA-controlled dtype categories."""
        if polars_dtype == ANNOTATION_POLARS_DTYPE:
            return "annotation"
        if polars_dtype in (
            pl.Int8,
            pl.Int16,
            pl.Int32,
            pl.Int64,
            pl.UInt8,
            pl.UInt16,
            pl.UInt32,
            pl.UInt64,
        ):
            return "integer"
        if polars_dtype in (pl.Float32, pl.Float64):
            return "float"
        if polars_dtype == pl.Boolean:
            return "boolean"
        if polars_dtype == pl.Categorical:
            return "categorical"
        if polars_dtype in (pl.Utf8, pl.String):
            return "string"
        if polars_dtype in (pl.Date, pl.Datetime, pl.Time):
            return "datetime"
        if polars_dtype == pl.List(pl.String) or polars_dtype == pl.List(pl.Utf8):
            return "list_string"

        cls_obj = getattr(polars_dtype, "__class__", None)
        cls_name = getattr(cls_obj, "__name__", "") if cls_obj else ""
        type_name = (
            getattr(polars_dtype, "__name__", "")
            if hasattr(polars_dtype, "__name__")
            else ""
        )
        lowered_type = type_name.lower()
        if (
            cls_name == "List"
            or lowered_type == "list"
            or cls_name == "Array"
            or lowered_type == "array"
        ):
            return "unknown"
        if cls_name == "Struct" or lowered_type == "struct":
            return "object"
        return "unknown"

    @staticmethod
    def get_node_schema_json_with_ldaca_dtype(node: Any) -> List[ColumnSchema]:
        """Build JSON-ready column schema with LDaCA dtype mapping."""
        data_schema = node.data.collect_schema()
        return [
            ColumnSchema(
                name=col_name,
                dtype=str(polars_type),
                js_type=DocWorkspaceDataTypeUtils.polars_dtype_to_ldaca_dtype(
                    polars_type
                ),
            )
            for col_name, polars_type in data_schema.items()
        ]
