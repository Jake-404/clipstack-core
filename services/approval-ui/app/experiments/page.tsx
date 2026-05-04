// All experiments (bandits) for the workspace. Doc 4 §2.3 list view.
//
// Mission Control's ExperimentsTile shows the 4 most recent and a
// "+N more" hint; this page is where that hint lands. Reuses the same
// BanditSummary contract from bandit-orchestrator's GET /bandits — no
// new server endpoint needed.
//
// Each row is a Link to /experiments/[banditId] so the path
// discoverability is symmetric with the tile: tile → list → detail.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { type BanditSummary } from "@/components/mission-control/ExperimentsTile";
import { getSession } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Experiments · Clipstack",
  description: "Live bandit experiments.",
};

const PROXY_TIMEOUT_MS = 5000;
const REVALIDATE_S = 15;

async function fetchAllBandits(): Promise<BanditSummary[]> {
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
        headers: {
          "X-Clipstack-Service-Token": token,
          "X-Clipstack-Active-Company": companyId,
          "X-Clipstack-Service-Name": "approval-ui",
        },
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
        next: { revalidate: REVALIDATE_S },
      },
    );
    if (!resp.ok) return [];
    const payload = (await resp.json()) as { bandits?: BanditSummary[] };
    return payload.bandits ?? [];
  } catch (err) {
    console.error("[experiments] fetchBandits failed", err);
    return [];
  }
}

function formatLeaderMean(mean: number | null): string {
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

export default async function ExperimentsListPage() {
  const bandits = await fetchAllBandits();

  // Group by platform for legibility — when a workspace runs N
  // experiments, scrolling down by platform reads cleaner than
  // chronological. Within a platform, newest-first matches the
  // tile's sort order.
  const byPlatform = bandits.reduce<Record<string, BanditSummary[]>>(
    (acc, b) => {
      (acc[b.platform] ??= []).push(b);
      return acc;
    },
    {},
  );
  const platforms = Object.keys(byPlatform).sort();

  return (
    <AppShell title="experiments">
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors duration-fast mb-4 rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          mission control
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-text-primary mb-2">
            experiments
          </h1>
          <p className="text-sm text-text-tertiary">
            Every bandit registered by the Strategist. Each row drills
            down to per-arm posteriors, variant body, and the α/β math
            driving Thompson sampling.
          </p>
        </div>

        {bandits.length === 0 ? (
          <Card size="medium" tone="default">
            <div className="text-sm text-text-tertiary leading-relaxed">
              No experiments registered yet. The Strategist registers
              one when it generates &gt; 1 hook variant per platform; the
              first piece that ships with{" "}
              <span className="font-mono">variants_per_platform</span>{" "}
              &gt; 1 will populate this view.
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            {platforms.map((platform) => {
              const group = byPlatform[platform];
              return (
                <section key={platform}>
                  <div className="flex items-baseline gap-2 mb-2 pb-1 border-b border-border-subtle">
                    <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                      {platform}
                    </h2>
                    <span className="text-xs text-text-tertiary font-mono tabular-nums">
                      {group.length} active
                    </span>
                  </div>
                  <ul className="divide-y divide-border-subtle">
                    {group.map((b) => {
                      const meanNum = b.leading_posterior_mean ?? 0;
                      const tone =
                        meanNum >= 0.65
                          ? "text-status-success"
                          : meanNum >= 0.5
                            ? "text-text-primary"
                            : "text-status-warning";
                      const arms = b.active_arm_count;
                      return (
                        <li key={b.bandit_id}>
                          <Link
                            href={`/experiments/${b.bandit_id}`}
                            className="flex items-baseline gap-3 py-3 hover:bg-bg-elevated transition-colors duration-fast -mx-2 px-2 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
                          >
                            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                              <span className="text-sm text-text-primary truncate">
                                {b.message_pillar || "(no pillar)"}
                              </span>
                              <span className="text-xs text-text-tertiary font-mono tabular-nums">
                                {arms}/{b.arm_count} arms ·{" "}
                                {b.total_allocations} alloc ·{" "}
                                {b.total_rewards} rwd ·{" "}
                                {formatAge(b.created_at)}
                              </span>
                            </div>
                            {b.active_arm_count < b.arm_count && (
                              <Badge variant="warning" className="shrink-0">
                                {b.arm_count - b.active_arm_count} pruned
                              </Badge>
                            )}
                            <span
                              className={`font-mono tabular-nums shrink-0 text-sm w-12 text-right ${tone}`}
                              title="leader posterior mean × 100"
                            >
                              {formatLeaderMean(b.leading_posterior_mean)}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-tertiary">
          <span className="font-mono tabular-nums">
            {bandits.length} total
          </span>
          <span aria-hidden>·</span>
          <span>thompson sampling · doc 4 §2.3</span>
          <span className="md:ml-auto">live · &lt;15s lag</span>
        </div>
      </div>
    </AppShell>
  );
}
