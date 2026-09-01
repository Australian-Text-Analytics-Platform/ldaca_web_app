"""Workspace aggregate owning node registration, ordering, and lineage."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

import polars_text  # noqa: F401  (register text namespace side-effects)

from .node import Node
from .provenance import NodeProvenance, compose_provenance, referenced_node_ids
from .tab import AnalysisKind, Tab, TopicModelingTabSettings
from .analysis import AnalysisRecord, AnalysisState, analysis_input_ids


@dataclass(frozen=True, slots=True)
class UnavailableChildRecord:
    """Opaque persisted child record retained across unrelated Workspace commits."""

    content: bytes
    reason: Literal["record_invalid", "incompatible_schema"]
    analysis_kind: AnalysisKind | None = None
    stored_schema_version: int | None = None
    supported_schema_version: int | None = None
    tab_id: uuid.UUID | None = None

    def __post_init__(self) -> None:
        versions = (self.stored_schema_version, self.supported_schema_version)
        if self.reason == "incompatible_schema":
            if self.analysis_kind is None or any(version is None for version in versions):
                raise ValueError(
                    "Incompatible child records require kind and schema versions"
                )
        elif any(version is not None for version in versions):
            raise ValueError("Invalid child records cannot expose schema versions")


class Workspace:
    """Core workspace managing a collection of Nodes and their relationships."""

    def __init__(
        self,
        *,
        name: str | None = None,
        workspace_id: uuid.UUID | None = None,
        created_at: datetime | None = None,
        modified_at: datetime | None = None,
    ) -> None:
        now = datetime.now(UTC)

        self.id = workspace_id or uuid.uuid4()
        self.name = name or f"workspace_{str(self.id)[:8]}"
        self.nodes: dict[uuid.UUID, Node] = {}
        self._node_order: list[uuid.UUID] = []
        self._unavailable_node_parents: dict[
            uuid.UUID, tuple[uuid.UUID, ...]
        ] = {}
        self.tabs: dict[uuid.UUID, Tab] = {}
        self._unavailable_tab_records: dict[uuid.UUID, UnavailableChildRecord] = {}
        self.analyses: dict[uuid.UUID, AnalysisRecord] = {}
        self._unavailable_analysis_records: dict[
            uuid.UUID, UnavailableChildRecord
        ] = {}
        self._children_by_parent: dict[uuid.UUID, list[Node]] = {}
        self.description: str = ""
        self.created_at: datetime = created_at or now
        self.modified_at: datetime = modified_at or now

    # Node management -------------------------------------------------

    def add_node(self, node: Node) -> Node:
        if node.id in self.nodes:
            raise ValueError(f"Workspace already contains node {node.id}")
        if any(parent is node for parent in node.parents):
            raise ValueError("A node cannot be its own parent")
        if len({parent.id for parent in node.parents}) != len(node.parents):
            raise ValueError("A node cannot contain duplicate parents")
        if any(
            parent.workspace is not self or self.nodes.get(parent.id) is not parent
            for parent in node.parents
        ):
            raise ValueError("Node parents must already belong to this workspace")
        if referenced_node_ids(node.provenance) != [
            parent.id for parent in node.parents
        ]:
            raise ValueError("Node parents do not match its provenance")
        source_workspace = node.workspace
        if source_workspace is not None and source_workspace is not self:
            raise ValueError("Node already belongs to another workspace")
        self.nodes[node.id] = node
        self._node_order.append(node.id)
        self._children_by_parent[node.id] = []
        for parent in node.parents:
            self._children_by_parent[parent.id].append(node)
        node.workspace = self
        return node

    def add_unavailable_node(
        self,
        node_id: uuid.UUID,
        parent_ids: list[uuid.UUID],
    ) -> None:
        if node_id in self.nodes or node_id in self._unavailable_node_parents:
            raise ValueError(f"Workspace already contains Data Block {node_id}")
        self._unavailable_node_parents[node_id] = tuple(parent_ids)
        self._node_order.append(node_id)

    @property
    def unavailable_node_ids(self) -> set[uuid.UUID]:
        return set(self._unavailable_node_parents)

    @property
    def node_ids(self) -> list[uuid.UUID]:
        return list(self._node_order)

    @property
    def root_node_count(self) -> int:
        return sum(not node.parents for node in self.nodes.values()) + sum(
            not parents for parents in self._unavailable_node_parents.values()
        )

    @property
    def leaf_node_count(self) -> int:
        parent_ids = {
            parent.id for node in self.nodes.values() for parent in node.parents
        } | {
            parent_id
            for parents in self._unavailable_node_parents.values()
            for parent_id in parents
        }
        return len(set(self._node_order) - parent_ids)

    def children_of(self, node_id: uuid.UUID) -> list[Node]:
        """Return the aggregate-owned children of one registered node."""

        return list(self._children_by_parent[node_id])

    def reorder_nodes(self, ordered_ids: list[uuid.UUID]) -> list[uuid.UUID]:
        """Apply an exact duplicate-free permutation of all workspace nodes."""

        if len(ordered_ids) != len(set(ordered_ids)) or set(ordered_ids) != set(
            self._node_order
        ):
            raise ValueError("Node order must be an exact duplicate-free permutation")
        self._node_order = list(ordered_ids)
        self.nodes = {
            node_id: self.nodes[node_id]
            for node_id in ordered_ids
            if node_id in self.nodes
        }
        return list(self._node_order)

    # Tab management --------------------------------------------------

    def add_tab(self, tab: Tab) -> Tab:
        tab_id = tab.id
        if tab_id in self.tabs:
            raise ValueError(f"Workspace already contains tab {tab_id}")
        if len(tab.analysis_ids) != len(set(tab.analysis_ids)):
            raise ValueError("A Tab cannot contain duplicate Analysis IDs")
        claimed_ids = {
            analysis_id
            for existing in self.tabs.values()
            for analysis_id in existing.analysis_ids
        }
        if claimed_ids.intersection(tab.analysis_ids):
            raise ValueError("An Analysis may belong to only one Tab")
        self.tabs[tab_id] = tab
        return tab

    def add_unavailable_tab(
        self,
        tab_id: uuid.UUID,
        record: UnavailableChildRecord,
    ) -> None:
        if tab_id in self.tabs or tab_id in self._unavailable_tab_records:
            raise ValueError(f"Workspace already contains tab {tab_id}")
        self._unavailable_tab_records[tab_id] = record

    @property
    def unavailable_tab_ids(self) -> set[uuid.UUID]:
        return set(self._unavailable_tab_records)

    def unavailable_tab_record(self, tab_id: uuid.UUID) -> UnavailableChildRecord:
        return self._unavailable_tab_records[tab_id]

    def remove_tab(self, tab_id: uuid.UUID) -> Tab | UnavailableChildRecord | None:
        tab = self.tabs.pop(tab_id, None)
        if tab is not None:
            return tab
        return self._unavailable_tab_records.pop(tab_id, None)

    # Analysis management --------------------------------------------

    def add_analysis(
        self,
        analysis: AnalysisRecord,
        *,
        link_to_tab: bool = True,
    ) -> AnalysisRecord:
        analysis_id = analysis.id
        if (
            analysis_id in self.analyses
            or analysis_id in self._unavailable_analysis_records
        ):
            raise ValueError(f"Workspace already contains analysis {analysis_id}")
        tab = self.tabs.get(analysis.tab_id)
        if analysis.parent_analysis_id is not None:
            parent = self.analyses.get(analysis.parent_analysis_id)
            if parent is None or parent.tab_id != analysis.tab_id:
                raise ValueError("A Sub-Analysis requires a parent in the same Tab")
        self.analyses[analysis_id] = analysis
        if link_to_tab and tab is None:
            raise ValueError("A live Analysis requires an existing Tab")
        if link_to_tab and tab is not None and analysis.id not in tab.analysis_ids:
            tab.analysis_ids.append(analysis.id)
        return analysis

    def add_unavailable_analysis(
        self,
        analysis_id: uuid.UUID,
        record: UnavailableChildRecord,
    ) -> None:
        if (
            analysis_id in self.analyses
            or analysis_id in self._unavailable_analysis_records
        ):
            raise ValueError(f"Workspace already contains analysis {analysis_id}")
        self._unavailable_analysis_records[analysis_id] = record

    @property
    def unavailable_analysis_ids(self) -> set[uuid.UUID]:
        return set(self._unavailable_analysis_records)

    def unavailable_analysis_record(
        self,
        analysis_id: uuid.UUID,
    ) -> UnavailableChildRecord:
        return self._unavailable_analysis_records[analysis_id]

    def remove_analysis(
        self, analysis_id: uuid.UUID
    ) -> AnalysisRecord | UnavailableChildRecord | None:
        analysis = self.analyses.get(analysis_id)
        if analysis is None:
            unavailable = self._unavailable_analysis_records.pop(analysis_id, None)
            if unavailable is not None:
                self._unlink_analysis_id(analysis_id)
            return unavailable

        descendants = self.analysis_descendants(analysis_id)
        for record in reversed(descendants):
            child_id = record.id
            self.analyses.pop(child_id, None)
            self._unlink_analysis_id(child_id)
        removed = self.analyses.pop(analysis_id)
        self._unlink_analysis_id(analysis_id)
        return removed

    def _unlink_analysis_id(self, analysis_id: uuid.UUID) -> None:
        for tab in self.tabs.values():
            if analysis_id in tab.analysis_ids:
                tab.analysis_ids.remove(analysis_id)
            settings = tab.settings
            if not isinstance(settings, TopicModelingTabSettings):
                continue
            selection = settings.projection_selection
            if selection is not None and selection.analysis_id == analysis_id:
                settings.projection_selection = None

    def replace_analysis(self, analysis: AnalysisRecord) -> AnalysisRecord:
        """Replace one valid lifecycle record without changing its identity."""

        analysis_id = analysis.id
        if analysis_id not in self.analyses:
            raise ValueError("Analysis does not exist")
        previous = self.analyses[analysis_id]
        if previous.parent_analysis_id != analysis.parent_analysis_id:
            raise ValueError("Analysis ownership cannot change")
        if previous.request != analysis.request:
            raise ValueError("Analysis request cannot change")
        self.analyses[analysis_id] = analysis
        return analysis

    def analysis_children(self, analysis_id: uuid.UUID) -> list[AnalysisRecord]:
        return [
            analysis
            for analysis in self.analyses.values()
            if analysis.parent_analysis_id == analysis_id
        ]

    def analysis_descendants(self, analysis_id: uuid.UUID) -> list[AnalysisRecord]:
        descendants: list[AnalysisRecord] = []
        pending = list(self.analysis_children(analysis_id))
        while pending:
            child = pending.pop(0)
            descendants.append(child)
            pending[0:0] = self.analysis_children(child.id)
        return descendants

    def live_analysis_ids(self) -> set[uuid.UUID]:
        """Return Analyses owned by the current Tab collection."""

        return {
            analysis_id
            for tab in self.tabs.values()
            for analysis_id in tab.analysis_ids
        }

    def analysis_tab_id(self, analysis_id: uuid.UUID) -> uuid.UUID | None:
        """Return the sole Tab owning an Analysis."""

        for tab_id, tab in self.tabs.items():
            if analysis_id in tab.analysis_ids:
                return tab_id
        unavailable = self._unavailable_analysis_records.get(analysis_id)
        return unavailable.tab_id if unavailable is not None else None

    def reserved_node_ids(self) -> set[uuid.UUID]:
        """Derive active shared input reservations from durable Analysis state."""

        reserved: set[uuid.UUID] = set()
        for analysis in self.analyses.values():
            if analysis.state in {AnalysisState.QUEUED, AnalysisState.RUNNING}:
                reserved.update(
                    analysis_input_ids(analysis.request)
                )
        return reserved

    def place_node_after_parent(self, node: Node) -> None:
        """Move ``node`` to sit immediately below its first in-workspace parent.

        Used by:
        - Backend node-creation helpers (``_create_and_persist_child_node``,
          clone and analysis Data Block Creation writers) because a freshly derived
          node should appear right under its mother node in the list view
          instead of being appended to the end.
        Why:
        - ``add_node`` deliberately appends so that loading a saved workspace
          preserves the persisted order; smart insertion is therefore an
          explicit post-creation step rather than ``add_node`` behavior.
        Flow:
        1. Resolve the node and bail out when it is unknown to this workspace.
        2. Find the first parent that also lives in this workspace (root/import
           nodes have none, so they keep their appended position).
        3. Reinsert the node directly after that parent via ``reorder_nodes``.
        """
        if self.nodes.get(node.id) is not node:
            raise ValueError("Node must belong to this workspace")
        if not node.parents:
            return
        parent_id = node.parents[0].id
        order = [nid for nid in self.nodes if nid != node.id]
        idx = order.index(parent_id)
        order.insert(idx + 1, node.id)
        self.reorder_nodes(order)

    def node_removal_affected_ids(self, node_id: uuid.UUID) -> set[uuid.UUID]:
        """Return the Data Blocks whose state deletion would rewrite."""

        if node_id not in self.nodes:
            return set()
        return {node_id, *(child.id for child in self.children_of(node_id))}

    def remove_node(self, node_id: uuid.UUID) -> bool:
        if node_id not in self.nodes:
            return False
        node = self.nodes[node_id]
        child_nodes = self.children_of(node_id)
        survivors = {key: value for key, value in self.nodes.items() if key != node_id}
        replacements: dict[uuid.UUID, tuple[NodeProvenance, list[Node]]] = {}

        # Validate every composed lineage before mutating the aggregate.
        for child in child_nodes:
            provenance = compose_provenance(
                child.provenance,
                removed_node_id=node_id,
                replacement=node.provenance,
            )
            parent_ids = referenced_node_ids(provenance)
            if child.id in parent_ids or any(
                parent_id not in survivors for parent_id in parent_ids
            ):
                raise ValueError("Deleting the node would create invalid provenance")
            replacements[child.id] = (
                provenance,
                [survivors[parent_id] for parent_id in parent_ids],
            )

        for child in child_nodes:
            provenance, parents = replacements[child.id]
            child.provenance = provenance
            child.parents = parents

        node.parents = []
        node.workspace = None
        del self.nodes[node_id]
        self._node_order.remove(node_id)
        self._children_by_parent = {key: [] for key in self.nodes}
        for child in self.nodes.values():
            for parent in child.parents:
                self._children_by_parent[parent.id].append(child)

        # The persisted plan remains part of the previous committed snapshot
        # until ``WorkspaceStore.commit`` atomically publishes metadata without
        # this node. Post-commit reconciliation then removes the old plan.
        return True

    # Dunder ----------------------------------------------------------
    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"Workspace(id={str(self.id)[:8]}, name='{self.name}', nodes={len(self.nodes)})"
        )


__all__ = ["Workspace"]
