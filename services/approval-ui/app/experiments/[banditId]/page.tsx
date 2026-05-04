// Bandit detail panel — drill-down from Mission Control's
// ExperimentsTile. Doc 4 §2.3 visibility surface.
//
// Renders one card per arm with:
//   - Variant body excerpt (the actual hook text)
//   - Posterior mean (Beta(α, β) / (α+β)) as percentage
//   - α / β / allocation count / reward count
//   - Pruned indicator (Doc 4 §2.3 step 4 — ≥0.15 below leader)
//   - Predicted percentile from USP 1 (the prior the orchestrator
//     seeded with)
//
// The 1-1 mapping between rows on this page and arms in the bandit-
// orchestrator's state file is intentional: an operator looking at a
// "wait, why is variant B never being picked?" question can see exact-
// ly what the math is doing — α/β + posterior mean + pruned flag tell
// the full story.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { cache } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { getSession } from "@/lib/api/session";

interface Arm {
  variant_id: string;
  draft_id: string | null;
  body_excerpt: string;
  predicted_percentile: number | null;
  alpha: number;
  beta: number;
  allocation_count: number;
  reward_count: number;
  reward_sum: number;
  pruned: boolean;
}

interface BanditState {
  bandit_id: string;
  company_id: string;
  campaign_id: string;
  platform: string;
  message_pillar: string;
  arms: Arm[];
  total_allocations: number;
  total_rewards: number;
  leading_arm: string | null;
  pruned_arms: string[];
}

const PROXY_TIMEOUT_MS = 5000;
const REVALIDATE_S = 15;

// React.cache memoises within a single render pass — generateMetadata and
// the page body both call fetchBanditState(banditId), and without cache()
// that would mean two upstream HTTP roundtrips to bandit-orchestrator per
// page render. cache() dedupes by argument equality for the request.
const fetchBanditState = cache(async function fetchBanditState(
  banditId: string,
): Promise<BanditState | null> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return null;

  const baseUrl = process.env.BANDIT_ORCH_BASE_URL;
  const token = process.env.SERVICE_TOKEN;
  if (!baseUrl || !token) return null;

  // bandit_id sanitisation matches the orchestrator's _bandit_path
  // helper — alnum + '_-' only. Never trust the URL param.
  const safeId = banditId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId || safeId !== banditId) return null;

  try {
    const resp = await fetch(
      `${baseUrl.replace(/\/$/, "")}/bandits/${encodeURIComponent(safeId)}/state`,
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
    if (resp.status === 404) return null;
    if (!resp.ok) return null;
    const state = (await resp.json()) as BanditState;
    // Cross-tenant defense at the page boundary even though the
    // orchestrator already enforces it: never render data for a
    // bandit that doesn't belong to the active workspace.
    if (state.company_id !== companyId) return null;
    return state;
  } catch (err) {
    console.error("[experiments-detail] fetchBanditState failed", { banditId, err });
    return null;
  }
});

function formatPosteriorMean(alpha: number, beta: number): string {
  const denom = alpha + beta;
  if (denom <= 0) return "—";
  return ((alpha / denom) * 100).toFixed(1);
}

function formatRewardAvg(rewardSum: number, rewardCount: number): string {
  if (rewardCount === 0) return "—";
  return (rewardSum / rewardCount).toFixed(1);
}

interface PageProps {
  params: Promise<{ banditId: string }>;
}

// Pull the bandit's message_pillar for the page title — fail-soft to a
// generic title on any fetch failure so a missing service or a stale
// link can't crash the metadata path. Page render is independent of
// this; it has its own notFound branch.
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  try {
    const { banditId } = await params;
    const state = await fetchBanditState(banditId);
    const pillar = state?.message_pillar?.trim();
    if (pillar) {
      return {
        title: `${pillar} · Experiment · Clipstack`,
        description: `Bandit experiment for the ${pillar} message pillar.`,
      };
    }
  } catch {
    /* fall through to generic */
  }
  return {
    title: "Experiment · Clipstack",
    description: "Bandit experiment detail.",
  };
}

export default async function BanditDetailPage({ params }: PageProps) {
  const { banditId } = await params;
  const state = await fetchBanditState(banditId);

  if (!state) {
    // Distinguish "no bandit found" (404 page) from "auth not ready"
    // — the fetcher returns null in both cases, but Next's notFound()
    // is the right semantic for "this URL doesn't address anything".
    notFound();
  }

  const leaderId = state.leading_arm;
  const totalArms = state.arms.length;
  const activeArms = state.arms.filter((a) => !a.pruned).length;

  return (
    <AppShell title={`experiment / ${state.message_pillar || "(no pillar)"}`}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        {/* Breadcrumb back to Mission Control */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors duration-fast mb-4 rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          mission control
        </Link>

        {/* Header strip — campaign metadata + counts */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-text-primary mb-2">
            {state.message_pillar || "(no pillar)"}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-text-tertiary font-mono tabular-nums">
            <Badge variant="default">{state.platform}</Badge>
            <span>·</span>
            <span>{activeArms}/{totalArms} arms active</span>
            <span>·</span>
            <span>{state.total_allocations} allocations</span>
            <span>·</span>
            <span>{state.total_rewards} rewards</span>
            {state.campaign_id && (
              <>
                <span>·</span>
                <span className="text-xs">campaign {state.campaign_id.slice(0, 8)}</span>
              </>
            )}
          </div>
        </div>

        {state.arms.length === 0 ? (
          <Card size="medium" tone="default">
            <div className="text-sm text-text-tertiary">
              This bandit has no registered arms yet. The Strategist
              should call <span className="font-mono">register_bandit</span>{" "}
              with at least 2 variants before <span className="font-mono">/allocate</span>{" "}
              can sample.
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {state.arms.map((arm) => {
              const isLeader = arm.variant_id === leaderId;
              const meanPct = formatPosteriorMean(arm.alpha, arm.beta);
              const meanNum =
                arm.alpha + arm.beta > 0
                  ? arm.alpha / (arm.alpha + arm.beta)
                  : 0;
              const meanTone =
                meanNum >= 0.65
                  ? "text-status-success"
                  : meanNum >= 0.5
                    ? "text-text-primary"
                    : "text-status-warning";
              const tone = arm.pruned
                ? "default"
                : isLeader
                  ? "accent"
                  : "default";
              return (
                <Card
                  key={arm.variant_id}
                  size="medium"
                  tone={tone}
                  className={
                    arm.pruned ? "opacity-60" : "flex flex-col"
                  }
                >
                  <CardHeader>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <CardLabel>{arm.variant_id}</CardLabel>
                      {arm.draft_id && (
                        <span className="text-xs text-text-tertiary font-mono tabular-nums">
                          draft {arm.draft_id.slice(0, 8)}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {isLeader && !arm.pruned && (
                        <Badge variant="success">leader</Badge>
                      )}
                      {arm.pruned && <Badge variant="warning">pruned</Badge>}
                    </div>
                  </CardHeader>

                  {/* Body excerpt — the actual variant text */}
                  <p className="text-sm text-text-primary leading-relaxed mb-4 line-clamp-4">
                    {arm.body_excerpt || (
                      <span className="text-text-tertiary italic">
                        (no excerpt provided at registration)
                      </span>
                    )}
                  </p>

                  {/* Posterior mean — the headline number */}
                  <div className="flex items-baseline gap-2 mb-3">
                    <span
                      className={`font-mono tabular-nums text-2xl font-semibold leading-none ${meanTone}`}
                    >
                      {meanPct}
                    </span>
                    <span className="text-xs text-text-tertiary">
                      posterior mean (×100)
                    </span>
                  </div>

                  {/* α / β / allocations / rewards — the math underneath */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-text-tertiary mt-auto pt-3 border-t border-border-subtle">
                    <div className="flex justify-between font-mono tabular-nums">
                      <span>α</span>
                      <span className="text-text-primary">
                        {arm.alpha.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between font-mono tabular-nums">
                      <span>β</span>
                      <span className="text-text-primary">
                        {arm.beta.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between font-mono tabular-nums">
                      <span>alloc</span>
                      <span className="text-text-primary">
                        {arm.allocation_count}
                      </span>
                    </div>
                    <div className="flex justify-between font-mono tabular-nums">
                      <span>rewards</span>
                      <span className="text-text-primary">
                        {arm.reward_count}
                      </span>
                    </div>
                    <div className="flex justify-between font-mono tabular-nums col-span-2">
                      <span>avg reward (when received)</span>
                      <span className="text-text-primary">
                        {formatRewardAvg(arm.reward_sum, arm.reward_count)}
                      </span>
                    </div>
                    {arm.predicted_percentile !== null && (
                      <div className="flex justify-between font-mono tabular-nums col-span-2">
                        <span>USP 1 prior (predicted)</span>
                        <span className="text-text-primary">
                          {arm.predicted_percentile.toFixed(0)}
                        </span>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Footer rail — same idiom as Mission Control */}
        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-tertiary">
          <span className="font-mono tabular-nums break-all">
            {state.bandit_id}
          </span>
          <span aria-hidden>·</span>
          <span>thompson sampling · doc 4 §2.3</span>
          <span className="md:ml-auto">live · &lt;15s lag</span>
        </div>
      </div>
    </AppShell>
  );
}
