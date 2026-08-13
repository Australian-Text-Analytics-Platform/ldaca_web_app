"""Security and behavior tests for the closed node-expression DSL."""

from __future__ import annotations

import uuid

import polars as pl
import pytest
from pydantic import ValidationError
from ldaca_wordflow.shared.errors import InvalidInputError
from ldaca_wordflow.models.node_resources import ExpressionNodeCreateRequest
from ldaca_wordflow.services.node_operations import _apply_expression


def test_typed_expression_is_compiled_without_python_evaluation() -> None:
    """Supported arithmetic compiles into a Polars plan with an explicit alias."""

    request = ExpressionNodeCreateRequest.model_validate(
        {
            "kind": "expression",
            "source_node_id": str(uuid.uuid4()),
            "context": "with_columns",
            "expressions": [
                {
                    "alias": "double",
                    "expression": {
                        "op": "multiply",
                        "left": {"op": "column", "name": "value"},
                        "right": {"op": "literal", "value": 2},
                    },
                }
            ],
        }
    )

    result = _apply_expression(pl.DataFrame({"value": [2, 3]}).lazy(), request)

    assert result.collect().to_dicts() == [
        {"value": 2, "double": 4},
        {"value": 3, "double": 6},
    ]


def test_python_code_and_unknown_operations_are_not_part_of_the_contract() -> None:
    """Executable strings and unregistered calls fail at request validation."""

    base = {
        "kind": "expression",
        "source_node_id": str(uuid.uuid4()),
        "context": "select",
    }
    with pytest.raises(ValidationError):
        ExpressionNodeCreateRequest.model_validate(
            {
                **base,
                "expressions": [
                    {
                        "code": "pl.read_csv('/etc/passwd')",
                        "expression": {"op": "literal", "value": 1},
                    }
                ],
            }
        )
    with pytest.raises(ValidationError):
        ExpressionNodeCreateRequest.model_validate(
            {
                **base,
                "expressions": [
                    {"expression": {"op": "read_csv", "value": "/etc/passwd"}}
                ],
            }
        )


def test_expression_columns_must_exist_in_the_source_schema() -> None:
    request = ExpressionNodeCreateRequest.model_validate(
        {
            "kind": "expression",
            "source_node_id": str(uuid.uuid4()),
            "context": "select",
            "expressions": [{"expression": {"op": "column", "name": "missing"}}],
        }
    )

    with pytest.raises(InvalidInputError, match="not present"):
        _apply_expression(pl.DataFrame({"value": [1]}).lazy(), request)
