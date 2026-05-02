"""publish_pipeline graph — compiles, has expected nodes + conditional edges."""

from __future__ import annotations

from workflows.publish_pipeline.graph import build_publish_pipeline

EXPECTED_NODE_NAMES = {
    "review_cycle",
    "percentile_gate",
    "awaiting_human_approval",
    "bandit_allocate",
    "publish_to_channel",
    "record_metering",
    "record_block_lesson",
    "record_deny_lesson",
}


def _node_names(compiled: object) -> set[str]:
    """Extract node names from a compiled LangGraph graph.

    LangGraph exposes the graph topology via `get_graph()` returning a
    Graph with `.nodes` (a dict). The set of node ids excludes the
    synthetic START / END markers.
    """
    g = compiled.get_graph()  # type: ignore[attr-defined]
    nodes = getattr(g, "nodes", None) or {}
    if isinstance(nodes, dict):
        names = set(nodes.keys())
    else:
        names = {getattr(n, "id", str(n)) for n in nodes}
    # Filter out synthetic markers — names vary by version (`__start__` vs START).
    return {n for n in names if n not in {"__start__", "__end__", "START", "END"}}


def test_build_publish_pipeline_compiles_without_errors() -> None:
    compiled = build_publish_pipeline()
    assert compiled is not None


def test_build_publish_pipeline_has_expected_nodes() -> None:
    compiled = build_publish_pipeline()
    names = _node_names(compiled)
    missing = EXPECTED_NODE_NAMES - names
    assert not missing, f"missing nodes: {missing}; got {names}"


def test_build_publish_pipeline_compiled_graph_is_runnable_shape() -> None:
    """Compiled LangGraph should expose `invoke` / `ainvoke` (the runnable
    interface). We don't run them — just check the shape exists."""
    compiled = build_publish_pipeline()
    assert hasattr(compiled, "invoke") or hasattr(compiled, "ainvoke")


def test_conditional_edges_wired_via_node_branches() -> None:
    """The three branching nodes (review_cycle, percentile_gate,
    awaiting_human_approval) carry conditional edges. We check via the
    graph topology — a branching node must connect to multiple downstream
    targets."""
    compiled = build_publish_pipeline()
    g = compiled.get_graph()  # type: ignore[attr-defined]

    # Build adjacency from edges. LangGraph's Graph.edges is iterable of
    # objects with .source / .target attrs (or tuples).
    adj: dict[str, set[str]] = {}
    for e in getattr(g, "edges", []):
        src = getattr(e, "source", None) or (e[0] if isinstance(e, tuple) else None)
        tgt = getattr(e, "target", None) or (e[1] if isinstance(e, tuple) else None)
        if src and tgt:
            adj.setdefault(str(src), set()).add(str(tgt))

    # review_cycle branches to: review_cycle (revise), percentile_gate (pass),
    # record_block_lesson (block).
    assert "review_cycle" in adj, "review_cycle has no outgoing edges"
    rc_targets = adj["review_cycle"]
    assert "percentile_gate" in rc_targets
    assert "record_block_lesson" in rc_targets

    # percentile_gate branches to: review_cycle (revise loop),
    # awaiting_human_approval (pass), record_block_lesson (out of revisions).
    assert "percentile_gate" in adj
    pg_targets = adj["percentile_gate"]
    assert "awaiting_human_approval" in pg_targets
    assert "record_block_lesson" in pg_targets

    # awaiting_human_approval branches to: bandit_allocate (approve),
    # record_deny_lesson (deny), awaiting_human_approval (pending).
    assert "awaiting_human_approval" in adj
    ah_targets = adj["awaiting_human_approval"]
    assert "bandit_allocate" in ah_targets
    assert "record_deny_lesson" in ah_targets


def test_terminal_nodes_route_to_end() -> None:
    """record_metering, record_block_lesson, record_deny_lesson all
    terminate the graph."""
    compiled = build_publish_pipeline()
    g = compiled.get_graph()  # type: ignore[attr-defined]

    edges_to_end: dict[str, bool] = {}
    for e in getattr(g, "edges", []):
        src = getattr(e, "source", None) or (e[0] if isinstance(e, tuple) else None)
        tgt = getattr(e, "target", None) or (e[1] if isinstance(e, tuple) else None)
        if tgt is not None and str(tgt) in {"__end__", "END"}:
            edges_to_end[str(src)] = True

    for terminal in ("record_metering", "record_block_lesson", "record_deny_lesson"):
        assert edges_to_end.get(terminal), f"{terminal} should edge to END"
