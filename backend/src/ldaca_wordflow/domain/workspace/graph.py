"""Workspace aggregate owning node registration, ordering, and lineage."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import polars_text  # noqa: F401  (register text namespace side-effects)

from .node import Node
from .provenance import NodeProvenance, compose_provenance, referenced_node_ids
from .tab import Tab
from .analysis import AnalysisRecord, AnalysisState, analysis_input_ids


class Workspace:
    """Core workspace managing a collection of Nodes and their relationships."""

    def __init__(
        self,
        *,
        name: str | None = None,
        workspace_id: str | None = None,
        created_at: str | None = None,
        modified_at: str | None = None,
    ) -> None:
        now = datetime.now(UTC).isoformat()

        self.id = workspace_id or str(uuid.uuid4())
        self.name = name or f"workspace_{self.id[:8]}"
        self.nodes: dict[str, Node] = {}
        self.tabs: dict[str, Tab] = {}
        self.analyses: dict[str, AnalysisRecord] = {}
        self._corrupt_analysis_records: dict[str, bytes] = {}
        self._children_by_parent: dict[str, list[Node]] = {}
        self.description: str = ""
        self.created_at: str = created_at or now
        self.modified_at: str = modified_at or now

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
        self._children_by_parent[node.id] = []
        for parent in node.parents:
            self._children_by_parent[parent.id].append(node)
        node.workspace = self
        return node

    def children_of(self, node_id: str) -> list[Node]:
        """Return the aggregate-owned children of one registered node."""

        return list(self._children_by_parent[node_id])

    def reorder_nodes(self, ordered_ids: list[str]) -> list[str]:
        """Apply an exact duplicate-free permutation of all workspace nodes."""

        if len(ordered_ids) != len(set(ordered_ids)) or set(ordered_ids) != set(
            self.nodes
        ):
            raise ValueError("Node order must be an exact duplicate-free permutation")
        self.nodes = {node_id: self.nodes[node_id] for node_id in ordered_ids}
        return list(self.nodes.keys())

    # Tab management --------------------------------------------------

    def add_tab(self, tab: Tab) -> Tab:
        tab_id = str(tab.id)
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

    def remove_tab(self, tab_id: str) -> Tab | None:
        return self.tabs.pop(tab_id, None)

    # Analysis management --------------------------------------------

    def add_analysis(
        self,
        analysis: AnalysisRecord,
        *,
        link_to_tab: bool = True,
    ) -> AnalysisRecord:
        analysis_id = str(analysis.id)
        if (
            analysis_id in self.analyses
            or analysis_id in self._corrupt_analysis_records
        ):
            raise ValueError(f"Workspace already contains analysis {analysis_id}")
        tab = self.tabs.get(str(analysis.tab_id))
        if analysis.parent_analysis_id is not None:
            parent = self.analyses.get(str(analysis.parent_analysis_id))
            if parent is None or parent.tab_id != analysis.tab_id:
                raise ValueError("A Sub-Analysis requires a parent in the same Tab")
        self.analyses[analysis_id] = analysis
        if link_to_tab and tab is None:
            raise ValueError("A live Analysis requires an existing Tab")
        if link_to_tab and tab is not None and analysis.id not in tab.analysis_ids:
            tab.analysis_ids.append(analysis.id)
        return analysis

    def add_corrupt_analysis(self, analysis_id: str, content: bytes) -> None:
        canonical_id = str(uuid.UUID(analysis_id))
        if canonical_id != analysis_id:
            raise ValueError("Corrupt Analysis storage identity is invalid")
        if (
            analysis_id in self.analyses
            or analysis_id in self._corrupt_analysis_records
        ):
            raise ValueError(f"Workspace already contains analysis {analysis_id}")
        self._corrupt_analysis_records[analysis_id] = content

    @property
    def corrupt_analysis_ids(self) -> set[str]:
        return set(self._corrupt_analysis_records)

    def corrupt_analysis_bytes(self, analysis_id: str) -> bytes:
        return self._corrupt_analysis_records[analysis_id]

    def remove_analysis(self, analysis_id: str) -> AnalysisRecord | bytes | None:
        analysis = self.analyses.get(analysis_id)
        if analysis is None:
            corrupt = self._corrupt_analysis_records.pop(analysis_id, None)
            if corrupt is not None:
                self._unlink_analysis_id(analysis_id)
            return corrupt

        descendants = self.analysis_descendants(analysis_id)
        for record in reversed(descendants):
            child_id = str(record.id)
            self.analyses.pop(child_id, None)
            self._unlink_analysis_id(child_id)
        removed = self.analyses.pop(analysis_id)
        self._unlink_analysis_id(analysis_id)
        return removed

    def _unlink_analysis_id(self, analysis_id: str) -> None:
        parsed = uuid.UUID(analysis_id)
        for tab in self.tabs.values():
            if parsed in tab.analysis_ids:
                tab.analysis_ids.remove(parsed)

    def replace_analysis(self, analysis: AnalysisRecord) -> AnalysisRecord:
        """Replace one valid lifecycle record without changing its identity."""

        analysis_id = str(analysis.id)
        if analysis_id not in self.analyses:
            raise ValueError("Analysis does not exist")
        previous = self.analyses[analysis_id]
        if previous.parent_analysis_id != analysis.parent_analysis_id:
            raise ValueError("Analysis ownership cannot change")
        if previous.request != analysis.request:
            raise ValueError("Analysis request cannot change")
        self.analyses[analysis_id] = analysis
        return analysis

    def analysis_children(self, analysis_id: str) -> list[AnalysisRecord]:
        return [
            analysis
            for analysis in self.analyses.values()
            if str(analysis.parent_analysis_id) == analysis_id
        ]

    def analysis_descendants(self, analysis_id: str) -> list[AnalysisRecord]:
        descendants: list[AnalysisRecord] = []
        pending = list(self.analysis_children(analysis_id))
        while pending:
            child = pending.pop(0)
            descendants.append(child)
            pending[0:0] = self.analysis_children(str(child.id))
        return descendants

    def live_analysis_ids(self) -> set[str]:
        """Return Analyses owned by the current Tab collection."""

        return {
            str(analysis_id)
            for tab in self.tabs.values()
            for analysis_id in tab.analysis_ids
        }

    def analysis_tab_id(self, analysis_id: str) -> str | None:
        """Return the sole Tab owning an Analysis."""

        for tab_id, tab in self.tabs.items():
            if any(str(item) == analysis_id for item in tab.analysis_ids):
                return tab_id
        return None

    def reserved_node_ids(self) -> set[str]:
        """Derive active shared input reservations from durable Analysis state."""

        reserved: set[str] = set()
        for analysis in self.analyses.values():
            if analysis.state in {AnalysisState.QUEUED, AnalysisState.RUNNING}:
                reserved.update(
                    str(node_id) for node_id in analysis_input_ids(analysis.request)
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

    def node_removal_affected_ids(self, node_id: str) -> set[str]:
        """Return the Data Blocks whose state deletion would rewrite."""

        if node_id not in self.nodes:
            return set()
        return {node_id, *(child.id for child in self.children_of(node_id))}

    def remove_node(self, node_id: str) -> bool:
        if node_id not in self.nodes:
            return False
        node = self.nodes[node_id]
        child_nodes = self.children_of(node_id)
        survivors = {key: value for key, value in self.nodes.items() if key != node_id}
        replacements: dict[str, tuple[NodeProvenance, list[Node]]] = {}

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
            f"Workspace(id={self.id[:8]}, name='{self.name}', nodes={len(self.nodes)})"
        )


__all__ = ["Workspace"]
