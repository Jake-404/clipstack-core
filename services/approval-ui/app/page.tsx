// Doc 7 §2.1 + Doc 8 §9.2 — Mission Control bento grid.
// Default home for the platform. 12-column asymmetric grid; tiles will be
// draggable in a later pass (Phase A.2). Numbers are mono with tabular-nums.

import { AppShell } from "@/components/layout/AppShell";
import { HeroKpiTile } from "@/components/mission-control/HeroKpiTile";
import { ApprovalQueueTile } from "@/components/mission-control/ApprovalQueueTile";
import { AgentActivityTile } from "@/components/mission-control/AgentActivityTile";
import {
  AnomaliesTile,
  type AnomalyDetection,
} from "@/components/mission-control/AnomaliesTile";
import { ExperimentsTile, type BanditSummary } from "@/components/mission-control/ExperimentsTile";
import {
  InstitutionalMemoryTile,
  type LessonStats,
} from "@/components/mission-control/InstitutionalMemoryTile";
import { MetricTile } from "@/components/mission-control/MetricTile";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/api/session";
import { withTenant } from "@/lib/db/client";
import { agents as agentsTable } from "@/lib/db/schema/agents";
import { drafts } from "@/lib/db/schema/drafts";
import { companyLessons } from "@/lib/db/schema/lessons";
import { meterEvents } from "@/lib/db/schema/metering";
import { postMetrics } from "@/lib/db/schema/post-metrics";
import { and, asc, count, eq, gte, inArray, sql } from "drizzle-orm";
import type {
  AgentMarkColor,
  AgentMarkShape,
} from "@/components/AgentMark";

// Mock data only — wired to real services slice-by-slice. The
// remaining consts are still mock until their fetch helpers ship:
// heroTrend (HeroKpiTile), agents (AgentActivityTile).
const heroTrend = [42, 45, 51, 49, 56, 60, 58, 63, 67, 65, 71, 73];

const agents = [
  { id: "mira",  label: "Mira",       role: "orchestrator", shape: "circle"         as const, color: "teal"    as const, status: "working" as const, recentAction: "drafting reply to Anthropic mention", costThisWeek: 4.21 },
  { id: "strat", label: "Strategist", role: "campaign brief shaping", shape: "hexagon" as const, color: "amber" as const, status: "idle"    as const, recentAction: "scored 12 posts overnight", costThisWeek: 1.84 },
  { id: "writer",label: "Long-form",  role: "long-form writer", shape: "rounded-square" as const, color: "violet" as const, status: "working" as const, recentAction: "MiCA explainer revision 2", costThisWeek: 6.30 },
  { id: "social",label: "Social",     role: "platform shaper",  shape: "diamond"      as const, color: "rose"    as const, status: "blocked" as const, recentAction: "waiting for image gen quota", costThisWeek: 2.05 },
  { id: "qa",    label: "Brand QA",   role: "voice + safety",   shape: "octagon"      as const, color: "sky"     as const, status: "idle"    as const, recentAction: "blocked 1 draft this morning", costThisWeek: 0.67 },
];

// Mission Control is a server component → it can directly call the
// internal helpers (no need for an HTTP roundtrip back to its own
// /api/companies/:cid/* routes). This keeps the first paint fast even
// when the orchestration calls are slow — Next.js Streaming + suspense
// let us decompose further if it ever bites.

const SERVICE_NAME = "approval-ui";
const PROXY_TIMEOUT_MS = 5000;
const REVALIDATE_S = 15;

function authHeaders(token: string, companyId: string): Record<string, string> {
  return {
    "X-Clipstack-Service-Token": token,
    "X-Clipstack-Active-Company": companyId,
    "X-Clipstack-Service-Name": SERVICE_NAME,
  };
}

async function fetchBandits(): Promise<BanditSummary[]> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return [];

  const baseUrl = process.env.BANDIT_ORCH_BASE_URL;
  const token = process.env.SERVICE_TOKEN;
  if (!baseUrl || !token) return [];

  try {
    const resp = await fetch(
      `${baseUrl.replace(/\/$/, "")}/bandits?company_id=${encodeURIComponent(
        companyId,
      )}`,
      {
        headers: authHeaders(token, companyId),
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
        next: { revalidate: REVALIDATE_S },
      },
    );
    if (!resp.ok) return [];
    const payload = (await resp.json()) as { bandits?: BanditSummary[] };
    return payload.bandits ?? [];
  } catch {
    return [];
  }
}

// Agent role → AgentMark visual mapping. Doc 8 §5.6 — every role
// has a stable (shape, color) so the same agent reads the same way
// across surfaces. New roles fall back to (circle, slate) which
// reads as "unspecified" rather than misattributing.
const AGENT_ROLE_VIZ: Record<
  string,
  { shape: AgentMarkShape; color: AgentMarkColor }
> = {
  orchestrator:        { shape: "circle",          color: "teal" },
  researcher:          { shape: "square",          color: "emerald" },
  strategist:          { shape: "hexagon",         color: "amber" },
  long_form_writer:    { shape: "rounded-square",  color: "violet" },
  social_adapter:      { shape: "diamond",         color: "rose" },
  newsletter_adapter:  { shape: "rounded-square",  color: "violet" },
  brand_qa:            { shape: "octagon",         color: "sky" },
  devils_advocate_qa:  { shape: "octagon",         color: "fuchsia" },
  claim_verifier:      { shape: "pentagon",        color: "slate" },
  engagement:          { shape: "triangle",        color: "rose" },
  lifecycle:           { shape: "circle",          color: "amber" },
  trend_detector:      { shape: "diamond",         color: "fuchsia" },
  algorithm_probe:     { shape: "pentagon",        color: "sky" },
  live_event_monitor:  { shape: "triangle",        color: "amber" },
  compliance:          { shape: "octagon",         color: "slate" },
};

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

async function fetchApprovalQueue(): Promise<{
  items: QueueItem[];
  totalPending: number;
}> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return { items: [], totalPending: 0 };

  const PENDING_STATUSES = ["awaiting_approval", "in_review"] as const;

  try {
    const [{ items, total }] = await withTenant(companyId, async (tx) => {
      // Two reads in one txn for consistency: the per-row list + the
      // total count. Could be a single query with a window function,
      // but Drizzle's window helpers aren't expressive enough for the
      // shape we want; the two-read pattern is clear and the lock
      // window is still tiny.
      const rows = await tx
        .select({
          id: drafts.id,
          title: drafts.title,
          channel: drafts.channel,
          createdAt: drafts.createdAt,
          predictedPercentile: drafts.predictedPercentile,
          agentRole: agentsTable.role,
          agentDisplayName: agentsTable.displayName,
        })
        .from(drafts)
        .leftJoin(agentsTable, eq(agentsTable.id, drafts.authoredByAgentId))
        .where(inArray(drafts.status, [...PENDING_STATUSES]))
        .orderBy(asc(drafts.createdAt))
        .limit(4);

      const [{ count: totalPending }] = await tx
        .select({ count: count() })
        .from(drafts)
        .where(inArray(drafts.status, [...PENDING_STATUSES]));

      return [{ items: rows, total: totalPending }];
    });

    const now = Date.now();
    const queueItems: QueueItem[] = items.map((row) => {
      const viz = AGENT_ROLE_VIZ[row.agentRole ?? ""] ?? {
        shape: "circle" as const,
        color: "slate" as const,
      };
      const label = (row.agentDisplayName ?? "?")
        .trim()
        .charAt(0)
        .toUpperCase() || "?";
      const ageMinutes = Math.max(
        0,
        Math.floor((now - row.createdAt.getTime()) / 60_000),
      );
      return {
        id: row.id,
        title: row.title?.trim() || "(untitled draft)",
        agentLabel: label,
        agentShape: viz.shape,
        agentColor: viz.color,
        ageMinutes,
        // Predicted percentile is null until percentile_gate runs;
        // surface 0 in the UI which the existing tile renders as
        // "danger" tone — visually flags "not yet predicted".
        predictedPercentile: Math.round(row.predictedPercentile ?? 0),
        channel: row.channel,
      };
    });

    return { items: queueItems, totalPending: Number(total ?? 0) };
  } catch {
    return { items: [], totalPending: 0 };
  }
}

interface KpiMetrics {
  // 7-day workspace-wide CTR (clicks / impressions). null when there's
  // no impressions in the window (cold workspace).
  ctr7d: number | null;
  // 7-day workspace-wide reach. 0 if no snapshots in the window.
  reach7d: number;
  // Month-to-date AI spend in USD (sum of meter_events.totalCostUsd
  // for the current calendar month). 0 if nothing metered yet.
  spendMtd: number;
}

async function fetchKpiMetrics(): Promise<KpiMetrics> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) {
    return { ctr7d: null, reach7d: 0, spendMtd: 0 };
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    // First of the current month, UTC. Mirrors the "ai spend · this
    // month" reading on the tile — month is calendar month, not 30d.
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    const [{ ctr7d, reach7d, spendMtd }] = await withTenant(
      companyId,
      async (tx) => {
        // Run the two SUMs over post_metrics + the SUM over
        // meter_events as separate selects. Drizzle doesn't naturally
        // express a 3-table aggregation in one statement; the txn
        // boundary keeps them consistent.
        const [pmRow] = await tx
          .select({
            sumImpressions: sql<number>`COALESCE(SUM(${postMetrics.impressions}), 0)::float8`,
            sumClicks: sql<number>`COALESCE(SUM(${postMetrics.clicks}), 0)::float8`,
            sumReach: sql<number>`COALESCE(SUM(${postMetrics.reach}), 0)::float8`,
          })
          .from(postMetrics)
          .where(gte(postMetrics.snapshotAt, sevenDaysAgo));

        const [meterRow] = await tx
          .select({
            sumCost: sql<number>`COALESCE(SUM(${meterEvents.totalCostUsd}), 0)::float8`,
          })
          .from(meterEvents)
          .where(gte(meterEvents.occurredAt, monthStart));

        const imp = Number(pmRow?.sumImpressions ?? 0);
        const clk = Number(pmRow?.sumClicks ?? 0);
        return [
          {
            ctr7d: imp > 0 ? clk / imp : null,
            reach7d: Number(pmRow?.sumReach ?? 0),
            spendMtd: Number(meterRow?.sumCost ?? 0),
          },
        ];
      },
    );

    return { ctr7d, reach7d, spendMtd };
  } catch {
    return { ctr7d: null, reach7d: 0, spendMtd: 0 };
  }
}

function formatReach(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

async function fetchLessonStats(): Promise<LessonStats> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  // No active workspace → empty stats. The tile renders cleanly on
  // pre-onboarding sessions where the user hasn't picked a workspace.
  if (!companyId) {
    return { totalCount: 0, thisWeekCount: 0, clientScopedCount: 0 };
  }

  // Direct DB read via withTenant — RLS scopes the query to this
  // workspace's lessons. No HTTP roundtrip; same process holds the
  // pool. The single-statement triple-aggregate keeps the lock window
  // tiny + lets Postgres parallelise the COUNT(*) FILTER (...) calls.
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [row] = await withTenant(companyId, async (tx) =>
      tx
        .select({
          total: count(),
          thisWeek: sql<number>`COUNT(*) FILTER (WHERE ${companyLessons.capturedAt} >= ${sevenDaysAgo})`,
          clientScoped: sql<number>`COUNT(*) FILTER (WHERE ${companyLessons.clientId} IS NOT NULL)`,
        })
        .from(companyLessons),
    );
    return {
      totalCount: Number(row?.total ?? 0),
      thisWeekCount: Number(row?.thisWeek ?? 0),
      clientScopedCount: Number(row?.clientScoped ?? 0),
    };
  } catch {
    // Mission Control should never crash on a stats query — the tile's
    // empty state is the right fallback.
    return { totalCount: 0, thisWeekCount: 0, clientScopedCount: 0 };
  }
}

async function fetchAnomalies(): Promise<AnomalyDetection[]> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return [];

  const baseUrl = process.env.PERFORMANCE_INGEST_BASE_URL;
  const token = process.env.SERVICE_TOKEN;
  if (!baseUrl || !token) return [];

  try {
    const resp = await fetch(
      `${baseUrl.replace(/\/$/, "")}/anomaly/scan`,
      {
        method: "POST",
        headers: {
          ...authHeaders(token, companyId),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          company_id: companyId,
          lookback_hours: 24,
          z_threshold: 2.5,
        }),
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
        next: { revalidate: REVALIDATE_S },
      },
    );
    if (!resp.ok) return [];
    const payload = (await resp.json()) as {
      detections?: AnomalyDetection[];
    };
    return payload.detections ?? [];
  } catch {
    return [];
  }
}

export default async function MissionControlPage() {
  // Fire all fetches in parallel — they're independent (HTTP to two
  // services + two local DB reads). Total wall-clock = max(...) rather
  // than the sum.
  const [bandits, anomalies, lessonStats, approvalQueue, kpis] =
    await Promise.all([
      fetchBandits(),
      fetchAnomalies(),
      fetchLessonStats(),
      fetchApprovalQueue(),
      fetchKpiMetrics(),
    ]);

  return (
    <AppShell title="Mission Control">
      <div className="p-6">
        {/* Doc 8 §9.2 — bento grid. 12 cols on desktop, stacks on mobile. */}
        <div className="grid grid-cols-12 gap-4 auto-rows-[minmax(120px,auto)]">
          <HeroKpiTile predicted={73} delta={8} trend={heroTrend} weeklyShipped={42} />

          <ApprovalQueueTile
            items={approvalQueue.items}
            totalPending={approvalQueue.totalPending}
          />

          <AgentActivityTile agents={agents} />

          {/* CTR · last 7d. Real data: SUM(clicks) / SUM(impressions)
              over post_metrics where snapshot_at >= now()-7d. Null
              when no impressions in the window — renders as "—" so
              the user can tell apart "0%" from "no data yet". */}
          <MetricTile
            label="ctr · last 7d"
            value={kpis.ctr7d === null ? "—" : (kpis.ctr7d * 100).toFixed(2)}
            unit={kpis.ctr7d === null ? undefined : "%"}
            size="medium"
            tone="default"
          />

          {/* Reach · last 7d. Real data: SUM(reach) over post_metrics
              in the same window. */}
          <MetricTile
            label="reach · last 7d"
            value={formatReach(kpis.reach7d)}
            size="medium"
          />

          {/* Crisis monitor — pulses red if active. Currently calm. */}
          <Card size="medium" tone="default">
            <CardHeader>
              <CardLabel>crisis monitor</CardLabel>
              <Badge variant="success">all clear</Badge>
            </CardHeader>
            <div className="text-sm text-text-secondary">
              No live-event triggers in the last 24h. Trend-watcher monitoring{" "}
              <span className="font-mono tabular-nums text-text-primary">14</span> sources.
            </div>
            <div className="mt-2 text-xs text-text-tertiary font-mono tabular-nums">
              last scan: 4m ago
            </div>
          </Card>

          {/* Performance anomalies — Doc 4 §2.2. Different signal class
              from crisis monitor: this surface watches the workspace's
              own drafts (z-score vs running mean), not the wider news
              cycle. Real data: detections come from performance-ingest's
              /anomaly/scan against histograms × last_values. */}
          <AnomaliesTile detections={anomalies} lookbackHours={24} zThreshold={2.5} />

          {/* AI spend · this month. Real data: SUM(total_cost_usd)
              over meter_events where occurred_at >= start-of-current-
              calendar-month UTC. Tracks ALL meter_event_kind rows
              (publish + metered_asset_generation + x402_inbound +
              x402_outbound + voice_score_query + compliance_check). */}
          <MetricTile
            label="ai spend · this month"
            value={`$${kpis.spendMtd.toFixed(2)}`}
            size="medium"
            tone="default"
          />

          {/* Editorial memory — Doc 7 + USP 5 moat. Real data: counts
              come from a single triple-aggregate over company_lessons,
              tenant-scoped via withTenant + RLS. */}
          <InstitutionalMemoryTile stats={lessonStats} />

          {/* Bandit experiments — Doc 4 §2.3. Real data: each row was
              registered by the Strategist (register_bandit tool), gets
              allocated by publish_pipeline's bandit_allocate node, and
              accumulates rewards via bandit-orchestrator's auto-reward
              consumer subscribed to content.metric_update. */}
          <ExperimentsTile bandits={bandits} />
        </div>

        {/* Footer rail — three-excellence reminder per Doc 7 §13. */}
        <div className="mt-8 flex items-center gap-4 text-xs text-text-tertiary">
          <span className="font-mono tabular-nums">core/0.1.0</span>
          <span>·</span>
          <span>dark · charcoal #0B0C0E · accent #3FA9A0</span>
          <span className="ml-auto">⌘K search · ⌘J chat · J/K nav · A approve</span>
        </div>
      </div>
    </AppShell>
  );
}
