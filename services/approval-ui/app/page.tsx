// Doc 7 §2.1 + Doc 8 §9.2 — Mission Control bento grid.
// Default home for the platform. 12-column asymmetric grid; tiles will be
// draggable in a later pass (Phase A.2). Numbers are mono with tabular-nums.

import { AppShell } from "@/components/layout/AppShell";
import { HeroKpiTile } from "@/components/mission-control/HeroKpiTile";
import { ApprovalQueueTile } from "@/components/mission-control/ApprovalQueueTile";
import { AgentActivityTile } from "@/components/mission-control/AgentActivityTile";
import { ExperimentsTile, type BanditSummary } from "@/components/mission-control/ExperimentsTile";
import { MetricTile } from "@/components/mission-control/MetricTile";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/api/session";

// Mock data only — wired to real services in Phase A.0 step 6.
// Real source: services/performance-ingest/ + services/agent-crewai/.
const heroTrend = [42, 45, 51, 49, 56, 60, 58, 63, 67, 65, 71, 73];
const ctrTrend  = [2.1, 2.4, 2.3, 2.8, 3.1, 3.4, 3.2, 3.5];
const reachTrend = [12, 18, 22, 19, 25, 28, 31, 34];

const queueItems = [
  { id: "a1", title: "Q2 outlook for VeChain holders — LinkedIn carousel", agentLabel: "S", agentShape: "hexagon" as const, agentColor: "amber" as const, ageMinutes: 12, predictedPercentile: 78, channel: "linkedin" },
  { id: "a2", title: "VTHO staking yield explainer thread", agentLabel: "C", agentShape: "circle" as const, agentColor: "violet" as const, ageMinutes: 47, predictedPercentile: 64, channel: "x" },
  { id: "a3", title: "MiCA Q&A — investor newsletter draft", agentLabel: "L", agentShape: "rounded-square" as const, agentColor: "violet" as const, ageMinutes: 92, predictedPercentile: 71, channel: "newsletter" },
  { id: "a4", title: "Q3 ecosystem partnership rollout — coordinated launch", agentLabel: "S", agentShape: "hexagon" as const, agentColor: "amber" as const, ageMinutes: 180, predictedPercentile: 49, channel: "x" },
];

const agents = [
  { id: "mira",  label: "Mira",       role: "orchestrator", shape: "circle"         as const, color: "teal"    as const, status: "working" as const, recentAction: "drafting reply to Anthropic mention", costThisWeek: 4.21 },
  { id: "strat", label: "Strategist", role: "campaign brief shaping", shape: "hexagon" as const, color: "amber" as const, status: "idle"    as const, recentAction: "scored 12 posts overnight", costThisWeek: 1.84 },
  { id: "writer",label: "Long-form",  role: "long-form writer", shape: "rounded-square" as const, color: "violet" as const, status: "working" as const, recentAction: "MiCA explainer revision 2", costThisWeek: 6.30 },
  { id: "social",label: "Social",     role: "platform shaper",  shape: "diamond"      as const, color: "rose"    as const, status: "blocked" as const, recentAction: "waiting for image gen quota", costThisWeek: 2.05 },
  { id: "qa",    label: "Brand QA",   role: "voice + safety",   shape: "octagon"      as const, color: "sky"     as const, status: "idle"    as const, recentAction: "blocked 1 draft this morning", costThisWeek: 0.67 },
];

// Mission Control is a server component → it can directly call the
// internal helpers (no need for an HTTP roundtrip back to its own
// /api/companies/:cid/experiments route). This keeps the first paint
// fast even when the bandit-orchestrator call is slow — Next.js
// Streaming + suspense let us decompose further if it ever bites.
async function fetchBandits(): Promise<BanditSummary[]> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return [];

  const baseUrl = process.env.BANDIT_ORCH_BASE_URL;
  const token = process.env.SERVICE_TOKEN;
  // Stub fallback — same offline-dev contract as the API route.
  if (!baseUrl || !token) return [];

  try {
    const resp = await fetch(
      `${baseUrl.replace(/\/$/, "")}/bandits?company_id=${encodeURIComponent(
        companyId,
      )}`,
      {
        headers: {
          "X-Clipstack-Service-Token": token,
          "X-Clipstack-Active-Company": companyId,
          "X-Clipstack-Service-Name": "approval-ui",
        },
        signal: AbortSignal.timeout(5000),
        // Mission Control polls in the background; let Next.js cache
        // briefly so a refresh-spam doesn't hammer the orchestrator.
        next: { revalidate: 15 },
      },
    );
    if (!resp.ok) return [];
    const payload = (await resp.json()) as {
      bandits?: BanditSummary[];
    };
    return payload.bandits ?? [];
  } catch {
    // Fail-soft on outage — empty list renders the tile's "no
    // experiments yet" state gracefully. Bus-status surfaces are
    // the right place to alert on backend health.
    return [];
  }
}

export default async function MissionControlPage() {
  const bandits = await fetchBandits();

  return (
    <AppShell title="Mission Control">
      <div className="p-6">
        {/* Doc 8 §9.2 — bento grid. 12 cols on desktop, stacks on mobile. */}
        <div className="grid grid-cols-12 gap-4 auto-rows-[minmax(120px,auto)]">
          <HeroKpiTile predicted={73} delta={8} trend={heroTrend} weeklyShipped={42} />

          <ApprovalQueueTile items={queueItems} totalPending={12} />

          <AgentActivityTile agents={agents} />

          <MetricTile
            label="ctr · last 7d"
            value="3.4"
            unit="%"
            delta={{ value: 0.6, label: "vs last week" }}
            trend={ctrTrend}
            size="medium"
            tone="default"
          />

          <MetricTile
            label="reach · last 7d"
            value="34.1k"
            delta={{ value: 6.2, label: "vs last week" }}
            trend={reachTrend}
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

          {/* Cost rollup */}
          <MetricTile
            label="ai spend · this month"
            value="$148.40"
            delta={{ value: -22, label: "vs forecast" }}
            size="medium"
            tone="default"
          />

          {/* Editorial memory — Doc 7 + the moat thesis */}
          <Card size="medium" tone="accent">
            <CardHeader>
              <CardLabel>institutional memory</CardLabel>
              <span className="text-xs text-text-tertiary font-mono tabular-nums">live</span>
            </CardHeader>
            <div className="space-y-2 text-sm">
              <div className="flex items-baseline gap-2">
                <span className="font-mono tabular-nums text-2xl font-semibold text-text-primary leading-none">
                  487
                </span>
                <span className="text-xs text-text-tertiary">lessons captured</span>
              </div>
              <div className="text-xs text-text-tertiary">
                <span className="font-mono tabular-nums text-status-success">+12</span> this week ·
                73 client-specific tone exceptions
              </div>
            </div>
          </Card>

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
