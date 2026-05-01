// Phase B.4 — branch view node.
// One revision rendered as a card with verdict + voice + percentile badges.
// Doc 8 tokens throughout (charcoal palette, accent-500, status-*).

"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Revision, ReviewVerdict, RevisionNode } from "./types";

interface BranchNodeProps {
  node: RevisionNode;
  /** Depth in the tree — used to indent branched revisions. 0 = root. */
  depth: number;
  /** Workspace voice threshold; defaults to 0.65 per voice-scorer config. */
  voiceThreshold?: number;
  /** Workspace percentile gate threshold; null = no auto-block. */
  percentileThreshold?: number | null;
  /** Optional handler for clicks on a node — opens the diff panel. */
  onSelect?: (rev: Revision) => void;
  /** id of the revision currently selected in the parent component. */
  selectedRevisionId?: string | null;
}

export function BranchNode({
  node,
  depth,
  voiceThreshold = 0.65,
  percentileThreshold = null,
  onSelect,
  selectedRevisionId = null,
}: BranchNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = node.id === selectedRevisionId;

  const handleClick = () => {
    onSelect?.(node);
    setExpanded((v) => !v);
  };

  const verdictBadge = renderVerdictBadge(node.reviewVerdict);
  const voiceBadge = renderVoiceBadge(node.voiceScore, node.voicePasses, voiceThreshold);
  const percentileBadge = renderPercentileBadge(
    node.predictedPercentile,
    node.predictedPercentileLow,
    node.predictedPercentileHigh,
    percentileThreshold,
  );

  return (
    <div className="relative">
      {/* Indent guide for branched depth */}
      {depth > 0 && (
        <div
          className="absolute left-0 top-0 bottom-0 border-l border-border-subtle"
          style={{ marginLeft: `${(depth - 1) * 24}px` }}
          aria-hidden
        />
      )}

      <div style={{ paddingLeft: `${depth * 24}px` }}>
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            "w-full text-left p-3 rounded-md border transition-colors duration-fast ease-default",
            "bg-bg-surface hover:border-border-strong",
            isSelected
              ? "border-accent-500/60"
              : "border-border-subtle",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono tabular-nums text-xs text-text-tertiary shrink-0">
                rev {node.revisionNumber.toString().padStart(2, "0")}
              </span>
              {verdictBadge}
              {voiceBadge}
              {percentileBadge}
            </div>
            <span className="text-xs text-text-tertiary font-mono tabular-nums shrink-0">
              {formatRelative(node.createdAt)}
            </span>
          </div>

          <div className="mt-2 text-sm text-text-primary line-clamp-3">
            {node.bodyExcerpt}
          </div>

          {expanded && node.criticNotes && (
            <div className="mt-3 pt-3 border-t border-border-subtle">
              <div className="text-xs uppercase tracking-wider font-medium text-text-tertiary mb-1">
                critic notes
              </div>
              <div className="text-sm text-text-secondary whitespace-pre-wrap">
                {node.criticNotes}
              </div>
            </div>
          )}
        </button>

        {node.children.map((child) => (
          <div key={child.id} className="mt-2">
            <BranchNode
              node={child}
              depth={depth + 1}
              voiceThreshold={voiceThreshold}
              percentileThreshold={percentileThreshold}
              onSelect={onSelect}
              selectedRevisionId={selectedRevisionId}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Badge renderers ──────────────────────────────────────────────────────

function renderVerdictBadge(verdict: ReviewVerdict | null) {
  if (verdict === null) return <Badge variant="outline">pending</Badge>;
  if (verdict === "pass") return <Badge variant="success">pass</Badge>;
  if (verdict === "revise") return <Badge variant="warning">revise</Badge>;
  return <Badge variant="danger">block</Badge>;
}

function renderVoiceBadge(
  score: number | null,
  passes: boolean | null,
  threshold: number,
) {
  if (score === null) return null;
  const ok = passes ?? score >= threshold;
  return (
    <Badge variant={ok ? "success" : "warning"}>
      <span className="font-mono tabular-nums">voice {score.toFixed(2)}</span>
    </Badge>
  );
}

function renderPercentileBadge(
  predicted: number | null,
  low: number | null,
  high: number | null,
  threshold: number | null,
) {
  if (predicted === null) return null;

  // Color tier: above threshold (or above 75 if no threshold) = success;
  // 50-74 = info; below 50 = warning.
  const lowerBound = threshold ?? 75;
  let variant: "success" | "info" | "warning";
  if (predicted >= lowerBound) variant = "success";
  else if (predicted >= 50) variant = "info";
  else variant = "warning";

  const band =
    low !== null && high !== null
      ? `±${Math.round((high - low) / 2)}`
      : "";

  return (
    <Badge variant={variant}>
      <span className="font-mono tabular-nums">
        p{Math.round(predicted)}
        {band ? ` ${band}` : ""}
      </span>
    </Badge>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
