// Doc 4 §2.3 — bandit experiments tile.
//
// Surfaces the workspace's live bandits with leader posteriors + arm
// counts + reward observations. Wired to the closed-loop pipeline:
// every bandit shown here was registered by the Strategist
// (register_bandit tool), gets allocated by the publish pipeline
// (bandit_allocate node), and accumulates rewards via the auto-reward
// consumer (consumer.py subscribed to content.metric_update).
//
// Data shape comes from bandit-orchestrator's BanditSummary (snake_case
// from FastAPI). Empty list → "no experiments yet" empty state. Future:
// click a row → variant detail panel showing per-arm posteriors via
// /bandits/:id/state.

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";

export interface BanditSummary {
  bandit_id: string;
  campaign_id: string;
  platform: string;
  message_pillar: string;
  algorithm: string;
  arm_count: number;
  active_arm_count: number;
  total_allocations: number;
  total_rewards: number;
  leading_arm: string | null;
  leading_posterior_mean: number | null;
  created_at: string | null;
}

interface ExperimentsTileProps {
  bandits: BanditSummary[];
}

function formatLeaderMean(mean: number | null): string {
  // Posterior mean is in [0, 1]; map to percentile-style readout in
  // [0, 100] so it lines up visually with the percentile_gate +
  // recent_anomalies surfaces. Two decimals because variance at K≈3-5
  // arms with N≈10-50 observations is meaningful at the second digit.
  if (mean === null) return "—";
  return (mean * 100).toFixed(1);
}

function formatAge(createdAt: string | null): string {
  if (!createdAt) return "—";
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return "—";
  const elapsed = Date.now() - created;
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function ExperimentsTile({ bandits }: ExperimentsTileProps) {
  const liveCount = bandits.length;

  return (
    <Card size="medium" tone="default" className="flex flex-col">
      <CardHeader>
        <CardLabel>experiments</CardLabel>
        <Badge variant={liveCount > 0 ? "info" : "default"}>
          {liveCount === 0 ? "none yet" : `${liveCount} live`}
        </Badge>
      </CardHeader>

      {bandits.length === 0 ? (
        // Doc 8 — empty state matches the institutional-memory tile's
        // "still learning" voice. Hints at the upstream cause so the
        // user knows what produces this view.
        <div className="text-sm text-text-tertiary leading-relaxed">
          The Strategist registers bandits when generating multiple hook
          variants per platform. Once a piece ships with{" "}
          <span className="font-mono tabular-nums text-text-primary">
            variants_per_platform
          </span>{" "}
          &gt; 1, its experiment lands here.
        </div>
      ) : (
        <ul className="text-sm space-y-2">
          {bandits.slice(0, 4).map((b) => {
            const leaderMeanPct = formatLeaderMean(b.leading_posterior_mean);
            // Tone the leader number — strong leader (≥65) is a clear
            // signal; mid (50-65) is exploring; weak (<50) is fighting
            // to find a winner. Matches the percentile_gate language.
            const meanNum = b.leading_posterior_mean ?? 0;
            const tone =
              meanNum >= 0.65
                ? "text-status-success"
                : meanNum >= 0.5
                  ? "text-text-primary"
                  : "text-status-warning";

            return (
              <li key={b.bandit_id}>
                <Link
                  href={`/experiments/${b.bandit_id}`}
                  className="flex items-baseline justify-between gap-3 -mx-2 px-2 py-1 rounded hover:bg-bg-elevated transition-colors duration-fast"
                >
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <span className="text-text-primary truncate">
                      {b.message_pillar || "(no pillar)"}
                    </span>
                    <span className="text-xs text-text-tertiary font-mono tabular-nums">
                      {b.platform} · {b.active_arm_count}/{b.arm_count} arms ·{" "}
                      {b.total_allocations} alloc · {b.total_rewards} rwd ·{" "}
                      {formatAge(b.created_at)}
                    </span>
                  </div>
                  <span
                    className={`font-mono tabular-nums shrink-0 text-sm ${tone}`}
                    title={`leader posterior mean × 100`}
                  >
                    {leaderMeanPct}
                  </span>
                </Link>
              </li>
            );
          })}
          {bandits.length > 4 && (
            <li className="pt-1 text-xs text-text-tertiary flex items-center gap-1">
              <span className="font-mono tabular-nums">
                +{bandits.length - 4}
              </span>{" "}
              more
              <ArrowUpRight className="h-3 w-3" aria-hidden />
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}
