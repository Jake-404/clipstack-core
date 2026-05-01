// Phase B.4 — branch view types.
// Mirrors the GET /api/companies/[cid]/drafts/[did]/revisions response shape.
// Centralised here so BranchView, BranchNode, and any future store/hook
// consume the same structural types.

export type ReviewVerdict = "pass" | "revise" | "block";

/** A single revision in the tree. The shape returned by the revisions API. */
export interface Revision {
  id: string;
  parentRevisionId: string | null;
  revisionNumber: number;
  /** Truncated to 500 chars by the API; full body fetched on-demand. */
  bodyExcerpt: string;
  voiceScore: number | null;
  voicePasses: boolean | null;
  predictedPercentile: number | null;
  predictedPercentileLow: number | null;
  predictedPercentileHigh: number | null;
  criticNotes: string | null;
  reviewVerdict: ReviewVerdict | null;
  authoredByAgentId: string | null;
  langgraphRunId: string | null;
  /** ISO-8601. */
  createdAt: string;
}

/** Tree node with resolved children. Built from a flat Revision[] by buildTree. */
export interface RevisionNode extends Revision {
  children: RevisionNode[];
}
