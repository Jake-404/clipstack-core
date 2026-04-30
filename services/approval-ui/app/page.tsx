// Doc 7 §2.1 + Doc 8 §9.2 — Mission Control bento grid.
// Default home for the platform. 12-column asymmetric grid; tiles will be
// draggable in a later pass (Phase A.2). Numbers are mono with tabular-nums.

import { AppShell } from "@/components/layout/AppShell";
import { HeroKpiTile } from "@/components/mission-control/HeroKpiTile";
import { ApprovalQueueTile } from "@/components/mission-control/ApprovalQueueTile";
import { AgentActivityTile } from "@/components/mission-control/AgentActivityTile";
import { MetricTile } from "@/components/mission-control/MetricTile";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Mock data only — wired to real services in Phase A.0 step 6.
// Real source: services/performance-ingest/ + services/agent-crewai/.
const heroTrend = [42, 45, 51, 49, 56, 60, 58, 63, 67, 65, 71, 73];
const ctrTrend  = [2.1, 2.4, 2.3, 2.8, 3.1, 3.4, 3.2, 3.5];
const reachTrend = [12, 18, 22, 19, 25, 28, 31, 34];

const queueItems = [
  { id: "a1", title: "Q2 outlook for VeChain holders — LinkedIn carousel", agentLabel: "S", agentShape: "hexagon" as const, agentColor: "amber" as const, ageMinutes: 12, predictedPercentile: 78, channel: "linkedin" },
  { id: "a2", title: "VTHO staking yield explainer thread", agentLabel: "C", agentShape: "circle" as const, agentColor: "violet" as const, ageMinutes: 47, predictedPercentile: 64, channel: "x" },
  { id: "a3", title: "MiCA Q&A — investor newsletter draft", agentLabel: "L", agentShape: "rounded-square" as const, agentColor: "violet" as const, ageMinutes: 92, predictedPercentile: 71, channel: "newsletter" },
  { id: "a4", title: "CREAM partnership announcement", agentLabel: "S", agentShape: "hexagon" as const, agentColor: "amber" as const, ageMinutes: 180, predictedPercentile: 49, channel: "x" },
];

const agents = [
  { id: "mira",  label: "Mira",       role: "orchestrator", shape: "circle"         as const, color: "teal"    as const, status: "working" as const, recentAction: "drafting reply to Anthropic mention", costThisWeek: 4.21 },
  { id: "strat", label: "Strategist", role: "campaign brief shaping", shape: "hexagon" as const, color: "amber" as const, status: "idle"    as const, recentAction: "scored 12 posts overnight", costThisWeek: 1.84 },
  { id: "writer",label: "Long-form",  role: "long-form writer", shape: "rounded-square" as const, color: "violet" as const, status: "working" as const, recentAction: "MiCA explainer revision 2", costThisWeek: 6.30 },
  { id: "social",label: "Social",     role: "platform shaper",  shape: "diamond"      as const, color: "rose"    as const, status: "blocked" as const, recentAction: "waiting for image gen quota", costThisWeek: 2.05 },
  { id: "qa",    label: "Brand QA",   role: "voice + safety",   shape: "octagon"      as const, color: "sky"     as const, status: "idle"    as const, recentAction: "blocked 1 draft this morning", costThisWeek: 0.67 },
];

export default function MissionControlPage() {
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

          {/* Bandit experiments — Doc 4 §2.3 */}
          <Card size="medium" tone="default">
            <CardHeader>
              <CardLabel>experiments</CardLabel>
              <Badge variant="info">3 live</Badge>
            </CardHeader>
            <ul className="text-sm space-y-1.5">
              <li className="flex items-center justify-between">
                <span className="text-text-secondary">hook-length variants</span>
                <span className="font-mono tabular-nums text-text-primary">+18%</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-text-secondary">cta placement</span>
                <span className="font-mono tabular-nums text-text-primary">+04%</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-text-secondary">emoji density (linkedin)</span>
                <span className="font-mono tabular-nums text-status-danger">-07%</span>
              </li>
            </ul>
          </Card>
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
