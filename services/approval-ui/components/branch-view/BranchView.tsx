// Phase B.4 — branch view (Doc 4 §4 HITL co-creation).
//
// Renders a draft's revision tree as a vertical timeline. Most cases are
// linear (1-3 sequential revisions); branches form when percentile_gate
// or review_cycle reroutes after a different gate already passed.
//
// Read-only. Pure component — takes `revisions: Revision[]` and renders.
// Hosting routes wire it up; this slice ships only the component + types.
//
// ──────────────────────────────────────────────────────────────────────────
// Usage example (when the route lands in a follow-up slice):
//
//   const { data } = await fetch(
//     `/api/companies/${companyId}/drafts/${draftId}/revisions`,
//   ).then(r => r.json());
//
//   <BranchView
//     revisions={data.data.revisions}
//     voiceThreshold={0.65}
//     percentileThreshold={50}
//     onSelectRevision={(rev) => setSelected(rev)}
//   />
// ──────────────────────────────────────────────────────────────────────────

"use client";

import { useMemo, useState } from "react";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BranchNode } from "./BranchNode";
import { buildTree } from "./buildTree";
import type { Revision } from "./types";

export interface BranchViewProps {
  revisions: Revision[];
  /** Workspace voice threshold; default 0.65. */
  voiceThreshold?: number;
  /** Workspace percentile gate; null = display only, no auto-block colouring. */
  percentileThreshold?: number | null;
  /** Optional callback when the user clicks a revision. */
  onSelectRevision?: (rev: Revision) => void;
}

export function BranchView({
  revisions,
  voiceThreshold = 0.65,
  percentileThreshold = null,
  onSelectRevision,
}: BranchViewProps) {
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);

  const tree = useMemo(() => buildTree(revisions), [revisions]);

  const handleSelect = (rev: Revision) => {
    setSelectedRevisionId(rev.id);
    onSelectRevision?.(rev);
  };

  // Headline summary — total revisions + final verdict + count of branches.
  const finalVerdict = revisions[revisions.length - 1]?.reviewVerdict ?? null;
  const branchCount = tree.length;

  return (
    <Card size="full" tone="default">
      <CardHeader>
        <CardLabel>revision history</CardLabel>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-tertiary font-mono tabular-nums">
            {revisions.length} revision{revisions.length === 1 ? "" : "s"}
          </span>
          {branchCount > 1 && (
            <Badge variant="info">
              <span className="font-mono tabular-nums">{branchCount} branches</span>
            </Badge>
          )}
          {finalVerdict !== null && (
            <Badge
              variant={
                finalVerdict === "pass"
                  ? "success"
                  : finalVerdict === "revise"
                    ? "warning"
                    : "danger"
              }
            >
              final: {finalVerdict}
            </Badge>
          )}
        </div>
      </CardHeader>

      {revisions.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-2">
          {tree.map((root) => (
            <BranchNode
              key={root.id}
              node={root}
              depth={0}
              voiceThreshold={voiceThreshold}
              percentileThreshold={percentileThreshold}
              onSelect={handleSelect}
              selectedRevisionId={selectedRevisionId}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="py-6 text-center">
      <div className="text-sm text-text-secondary">
        No revisions captured yet.
      </div>
      <div className="mt-1 text-xs text-text-tertiary">
        The publish_pipeline persists a row per <code className="font-mono">review_cycle</code>{" "}
        pass when LANGGRAPH_PERSIST_REVISIONS is enabled.
      </div>
    </div>
  );
}
