// Doc 4 §2.2 — anomaly alerts tile.
//
// Surfaces drafts whose latest snapshot deviates more than the
// workspace's z_threshold from its running mean. Wired to the
// closed-loop measurement path: every detection here was computed
// from the histograms × last_values that performance-ingest's /ingest
// hot path writes on every snapshot.
//
// Empty state is the common case for a healthy workspace — most
// drafts perform within their distribution. Anomalies are by
// definition rare; the tile's job is to make them legible the
// moment they appear, not to fill space.

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";

export interface AnomalyDetection {
  draft_id: string;
  platform: string;
  metric: string;
  z_score: number;
  value: number;
  rolling_mean: number;
  rolling_std: number;
  detected_at: string;
}

interface AnomaliesTileProps {
  detections: AnomalyDetection[];
  // Surfaced for the empty-state copy. Defaults match the bus-side
  // detector's defaults so the tile and /ingest agree on what's
  // "normal".
  lookbackHours?: number;
  zThreshold?: number;
}

function formatZScore(z: number): string {
  // Sigma units; one decimal is enough at the threshold floor (2.5σ)
  // and avoids fake-precision at extreme tails.
  const sign = z >= 0 ? "+" : "";
  return `${sign}${z.toFixed(1)}σ`;
}

function formatValue(v: number): string {
  // Big numbers (impressions) get k/M; small (rates) get raw.
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  if (Math.abs(v) >= 10) return v.toFixed(0);
  return v.toFixed(2);
}

function shortDraftId(draftId: string): string {
  // Mission Control draft IDs are uuids; a 4-char prefix is enough to
  // disambiguate within a tile and stays scannable. Click-through to
  // the full id lands when the draft-detail panel ships.
  return draftId.length > 8 ? draftId.slice(0, 8) : draftId;
}

export function AnomaliesTile({
  detections,
  lookbackHours = 24,
  zThreshold = 2.5,
}: AnomaliesTileProps) {
  const count = detections.length;

  return (
    <Card size="medium" tone="default" className="flex flex-col">
      <CardHeader>
        <CardLabel>anomalies</CardLabel>
        {count === 0 ? (
          <Badge variant="success">stable</Badge>
        ) : (
          <Badge variant={count > 3 ? "warning" : "info"}>
            {count} signal{count === 1 ? "" : "s"}
          </Badge>
        )}
      </CardHeader>

      {detections.length === 0 ? (
        <div className="text-sm text-text-tertiary leading-relaxed">
          Every draft performing within{" "}
          <span className="font-mono tabular-nums text-text-primary">
            ±{zThreshold}σ
          </span>{" "}
          of the workspace's running mean across the last{" "}
          <span className="font-mono tabular-nums text-text-primary">
            {lookbackHours}h
          </span>
          . The Strategist polls this surface before drafting — when it
          populates, recent spikes feed back as context.
        </div>
      ) : (
        <ul className="text-sm space-y-2">
          {detections.slice(0, 5).map((d, idx) => {
            const isSpike = d.z_score > 0;
            const Icon = isSpike ? ArrowUpRight : ArrowDownRight;
            const zTone = isSpike
              ? "text-status-success"
              : "text-status-danger";
            const key = `${d.draft_id}-${d.platform}-${d.metric}-${idx}`;
            return (
              <li
                key={key}
                className="flex items-baseline justify-between gap-3"
              >
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-text-primary">
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${zTone}`} aria-hidden />
                    <span className="font-mono tabular-nums text-xs">
                      {shortDraftId(d.draft_id)}
                    </span>
                    <span className="text-text-secondary truncate">
                      · {d.platform} · {d.metric}
                    </span>
                  </div>
                  <span className="text-xs text-text-tertiary font-mono tabular-nums">
                    {formatValue(d.value)} (μ {formatValue(d.rolling_mean)} ±{" "}
                    {formatValue(d.rolling_std)})
                  </span>
                </div>
                <span
                  className={`font-mono tabular-nums shrink-0 text-sm ${zTone}`}
                  title={`z-score (signed)`}
                >
                  {formatZScore(d.z_score)}
                </span>
              </li>
            );
          })}
          {detections.length > 5 && (
            <li className="pt-1 text-xs text-text-tertiary flex items-center gap-1">
              <span className="font-mono tabular-nums">
                +{detections.length - 5}
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
