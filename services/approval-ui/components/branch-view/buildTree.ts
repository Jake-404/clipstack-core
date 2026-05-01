// Build a revision tree from a flat list. Linear chains are the common
// case (most reviews resolve in 1-3 sequential revisions); branches form
// when percentile_gate reroutes to review_cycle after a different gate
// already passed.

import type { Revision, RevisionNode } from "./types";

/**
 * Builds a forest from the flat list. Returns the root nodes (those whose
 * parentRevisionId is null OR whose parent isn't in the input list — the
 * latter handles partial loads).
 *
 * Children sorted by revisionNumber ascending so the chain renders in
 * chronological order without further sorting at render time.
 */
export function buildTree(revisions: Revision[]): RevisionNode[] {
  const byId = new Map<string, RevisionNode>();
  for (const r of revisions) {
    byId.set(r.id, { ...r, children: [] });
  }

  const roots: RevisionNode[] = [];
  for (const r of revisions) {
    const node = byId.get(r.id)!;
    if (r.parentRevisionId && byId.has(r.parentRevisionId)) {
      byId.get(r.parentRevisionId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortChildren = (n: RevisionNode): void => {
    n.children.sort((a, b) => a.revisionNumber - b.revisionNumber);
    n.children.forEach(sortChildren);
  };
  roots.sort((a, b) => a.revisionNumber - b.revisionNumber);
  roots.forEach(sortChildren);

  return roots;
}
