// Doc 7 §2.1 approval-queue tile. List the next N approvals with age + predicted percentile.
// Mobile swipe queue (Doc 4 §4.1) lives at /inbox; this tile is the desktop summary.
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AgentMark, type AgentMarkColor, type AgentMarkShape } from "@/components/AgentMark";

interface QueueItem {
  id: string;
  title: string;
  agentLabel: string;
  agentColor: AgentMarkColor;
  agentShape: AgentMarkShape;
  ageMinutes: number;
  predictedPercentile: number;
  channel: string;
}

interface ApprovalQueueTileProps {
  items: QueueItem[];
  totalPending: number;
}

function formatAge(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function ApprovalQueueTile({ items, totalPending }: ApprovalQueueTileProps) {
  return (
    <Card size="large" tone="default" className="flex flex-col">
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <CardLabel>approval queue</CardLabel>
          <span className="text-xs text-text-tertiary">
            <span className="font-mono tabular-nums text-text-primary">{totalPending}</span>{" "}
            pending
          </span>
        </div>
        <Link
          href="/inbox"
          className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors duration-fast"
        >
          open inbox
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </CardHeader>

      <ul className="divide-y divide-border-subtle -mx-4">
        {items.map((it) => {
          const pTone = it.predictedPercentile >= 70
            ? "success"
            : it.predictedPercentile >= 50
              ? "warning"
              : "danger";
          return (
            <li key={it.id}>
              <Link
                href={`/drafts/${it.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-elevated transition-colors duration-fast"
              >
                <AgentMark
                  shape={it.agentShape}
                  color={it.agentColor}
                  size="sm"
                  title={it.agentLabel}
                  initial={it.agentLabel}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text-primary truncate">{it.title}</div>
                  <div className="text-xs text-text-tertiary">
                    <span>{it.channel}</span>
                    <span className="mx-1.5">·</span>
                    <span className="font-mono tabular-nums">{formatAge(it.ageMinutes)}</span>
                  </div>
                </div>
                <Badge variant={pTone} className="font-mono tabular-nums shrink-0">
                  p{it.predictedPercentile}
                </Badge>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
