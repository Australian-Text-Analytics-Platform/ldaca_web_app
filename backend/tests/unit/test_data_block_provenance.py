"""Typed Data Block provenance and descendant-preserving deletion contracts."""

from __future__ import annotations

import uuid

import polars as pl
import pytest
from pydantic import ValidationError

from ldaca_wordflow.domain.workspace import (
    DerivationInput,
    DerivationProvenance,
    Node,
    NodeReference,
    Workspace,
    describe_provenance,
    node_reference,
    referenced_node_ids,
)
from ldaca_wordflow.domain.workspace.provenance import (
    CloneDerivation,
    ConcatDerivation,
    FilterCondition,
    FilterDerivation,
    JoinDerivation,
)


def _source(name: str) -> Node:
    return Node(
        id=str(uuid.uuid4()),
        name=name,
        data=pl.DataFrame({"value": [1]}).lazy(),
    )


def _unary(name: str, parent: Node, operation) -> Node:
    return Node(
        id=str(uuid.uuid4()),
        name=name,
        data=parent.data,
        parents=[parent],
        provenance=DerivationProvenance(
            operation=operation,
            inputs=[
                DerivationInput(
                    role="source",
                    value=node_reference(parent.id),
                )
            ],
        ),
    )


def test_deleting_an_ancestor_composes_its_typed_derivation() -> None:
    workspace = Workspace(name="composition")
    source = workspace.add_node(_source("Source"))
    clone = workspace.add_node(_unary("Clone", source, CloneDerivation()))
    filtered = workspace.add_node(
        _unary(
            "Filtered",
            clone,
            FilterDerivation(
                conditions=[FilterCondition(column="value", operator="gte", value=1)]
            ),
        )
    )

    assert workspace.remove_node(clone.id)

    assert filtered.parents == [source]
    assert referenced_node_ids(filtered.provenance) == [source.id]
    assert isinstance(filtered.provenance, DerivationProvenance)
    composed_input = filtered.provenance.inputs[0].value
    assert isinstance(composed_input, DerivationProvenance)
    assert isinstance(composed_input.operation, CloneDerivation)
    assert isinstance(composed_input.inputs[0].value, NodeReference)
    assert str(composed_input.inputs[0].value.node_id) == source.id
    assert (
        describe_provenance(
            filtered.provenance,
            resolve_name=lambda node_id: workspace.nodes[node_id].name,
        )
        == "filter of clone of Source"
    )


def test_deletion_preserves_join_and_concatenation_input_order_and_roles() -> None:
    workspace = Workspace(name="ordered composition")
    left = workspace.add_node(_source("Left"))
    right = workspace.add_node(_source("Right"))
    intermediate = workspace.add_node(_unary("Intermediate", left, CloneDerivation()))
    join = workspace.add_node(
        Node(
            id=str(uuid.uuid4()),
            name="Join",
            data=left.data,
            parents=[intermediate, right],
            provenance=DerivationProvenance(
                operation=JoinDerivation(
                    left_on="value",
                    right_on="value",
                ),
                inputs=[
                    DerivationInput(
                        role="left",
                        value=node_reference(intermediate.id),
                    ),
                    DerivationInput(
                        role="right",
                        value=node_reference(right.id),
                    ),
                ],
            ),
        )
    )
    concatenation = workspace.add_node(
        Node(
            id=str(uuid.uuid4()),
            name="Concatenation",
            data=left.data,
            parents=[intermediate, right],
            provenance=DerivationProvenance(
                operation=ConcatDerivation(),
                inputs=[
                    DerivationInput(
                        role="member",
                        value=node_reference(intermediate.id),
                    ),
                    DerivationInput(
                        role="member",
                        value=node_reference(right.id),
                    ),
                ],
            ),
        )
    )

    assert workspace.remove_node(intermediate.id)

    assert join.parents == [left, right]
    assert isinstance(join.provenance, DerivationProvenance)
    assert [item.role for item in join.provenance.inputs] == ["left", "right"]
    assert isinstance(join.provenance.inputs[0].value, DerivationProvenance)
    assert concatenation.parents == [left, right]
    assert isinstance(concatenation.provenance, DerivationProvenance)
    assert [item.role for item in concatenation.provenance.inputs] == [
        "member",
        "member",
    ]
    assert isinstance(concatenation.provenance.inputs[0].value, DerivationProvenance)


def test_derivation_roles_are_closed_and_operation_specific() -> None:
    with pytest.raises(ValidationError, match="ordered left and right"):
        DerivationProvenance(
            operation=JoinDerivation(left_on="value", right_on="value"),
            inputs=[
                DerivationInput(role="right", value=node_reference(str(uuid.uuid4()))),
                DerivationInput(role="left", value=node_reference(str(uuid.uuid4()))),
            ],
        )

    with pytest.raises(ValidationError, match="two or more members"):
        DerivationProvenance(
            operation=ConcatDerivation(),
            inputs=[
                DerivationInput(role="member", value=node_reference(str(uuid.uuid4())))
            ],
        )
