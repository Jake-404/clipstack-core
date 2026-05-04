// Draft detail page. Doc 7 §2.3 inbox 3-pane right column — gets to a
// real surface from any of:
//   - Mission Control's ApprovalQueueTile (pending drafts)
//   - Mission Control's AnomaliesTile (drafts with z-score signals)
//   - (future) the inbox swipe queue at /inbox
//
// Phase A scope: draft body + status + per-platform recent metric
// snapshots. Sparklines + claim-verification side-pane + DevilsAdvocate
// notes land in follow-up slices; the page renders cleanly without
// them and the URL space is bookmarkable today.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { cache } from "react";
import { and, desc, eq } from "drizzle-orm";

import { AppShell } from "@/components/layout/AppShell";
import { ApprovalActions } from "@/components/draft/ApprovalActions";
import { Badge } from "@/components/ui/badge";

// Mirrors the badge component's variant union — kept inline rather
// than re-exporting from badge.tsx because Badge derives its variant
// type via cva and re-exporting would couple this page to that helper.
type BadgeTone =
  | "default"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "outline";

// Drafts in these statuses have an active approval row pending —
// approve/deny buttons render. Other statuses (drafting, approved,
// denied, scheduled, published, archived) don't show actions; the
// approval has either not been requested yet or already decided.
const PENDING_APPROVAL_STATUSES = new Set([
  "in_review",
  "awaiting_approval",
]);
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { withTenant } from "@/lib/db/client";
import { drafts } from "@/lib/db/schema/drafts";
import { postMetrics } from "@/lib/db/schema/post-metrics";
import { isUuid } from "@/lib/validation/uuid";
import { getSession } from "@/lib/api/session";

interface DraftDetail {
  id: string;
  title: string | null;
  body: string;
  channel: string;
  status: string;
  voiceScore: number | null;
  predictedPercentile: number | null;
  publishedUrl: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  scheduledAt: Date | null;
  approvalId: string | null;
}

interface MetricRow {
  snapshotAt: Date;
  platform: string;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  conversions: number | null;
  engagementPercentile: number | null;
}

const STATUS_TONES: Record<string, BadgeTone> = {
  drafting: "default",
  in_review: "info",
  awaiting_approval: "warning",
  approved: "success",
  scheduled: "info",
  published: "success",
  denied: "danger",
  archived: "default",
};

// React.cache memoises within a single render pass — generateMetadata and
// the page body both call fetchDraft(draftId), and without cache() that
// would mean two DB roundtrips per page render. cache() dedupes by argument
// equality for the duration of the request.
const fetchDraft = cache(async function fetchDraft(
  draftId: string,
): Promise<{ draft: DraftDetail; metrics: MetricRow[] } | null> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return null;
  if (!isUuid(draftId)) return null;

  try {
    const result = await withTenant(companyId, async (tx) => {
      const [draftRow] = await tx
        .select({
          id: drafts.id,
          title: drafts.title,
          body: drafts.body,
          channel: drafts.channel,
          status: drafts.status,
          voiceScore: drafts.voiceScore,
          predictedPercentile: drafts.predictedPercentile,
          publishedUrl: drafts.publishedUrl,
          publishedAt: drafts.publishedAt,
          createdAt: drafts.createdAt,
          scheduledAt: drafts.scheduledAt,
          approvalId: drafts.approvalId,
        })
        .from(drafts)
        .where(eq(drafts.id, draftId))
        .limit(1);

      if (!draftRow) return null;

      // Recent metric snapshots — newest first, capped at 20 so the
      // table stays scannable. Per (draft, platform, snapshot_at)
      // there's typically one row per polling tick; 20 covers ~24h
      // at the 60-300s active-window cadence per Doc 4 §2.2.
      const metricRows = await tx
        .select({
          snapshotAt: postMetrics.snapshotAt,
          platform: postMetrics.platform,
          impressions: postMetrics.impressions,
          reach: postMetrics.reach,
          clicks: postMetrics.clicks,
          reactions: postMetrics.reactions,
          comments: postMetrics.comments,
          shares: postMetrics.shares,
          saves: postMetrics.saves,
          conversions: postMetrics.conversions,
          engagementPercentile: postMetrics.engagementPercentile,
        })
        .from(postMetrics)
        .where(and(eq(postMetrics.draftId, draftId)))
        .orderBy(desc(postMetrics.snapshotAt))
        .limit(20);

      return { draft: draftRow, metrics: metricRows };
    });

    return result;
  } catch (err) {
    console.error("[draft-detail] fetchDraft failed", { draftId, err });
    return null;
  }
});

function formatNum(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

function formatTimestamp(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16);
}

interface PageProps {
  params: Promise<{ draftId: string }>;
}

// Pull the draft title for the page title — fail-soft to a generic
// title on any fetch failure so a missing draft / DB hiccup can't
// crash the metadata path. Page render handles notFound separately.
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  try {
    const { draftId } = await params;
    const result = await fetchDraft(draftId);
    const title = result?.draft.title?.trim();
    if (title) {
      return {
        title: `${title} · Draft · Clipstack`,
        description: `Draft detail — body, status, recent metric snapshots.`,
      };
    }
  } catch {
    /* fall through to generic */
  }
  return {
    title: "Draft · Clipstack",
    description: "Draft detail — body, status, recent metric snapshots.",
  };
}

export default async function DraftDetailPage({ params }: PageProps) {
  const { draftId } = await params;
  const result = await fetchDraft(draftId);
  if (!result) notFound();

  const { draft, metrics } = result;
  const statusTone: BadgeTone = STATUS_TONES[draft.status] ?? "default";

  return (
    <AppShell title={`draft / ${draft.title ?? "(untitled)"}`}>
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
            {draft.title ?? "(untitled draft)"}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-text-tertiary font-mono tabular-nums">
            <Badge variant={statusTone}>{draft.status}</Badge>
            <span>·</span>
            <span>{draft.channel}</span>
            {draft.voiceScore !== null && (
              <>
                <span>·</span>
                <span>voice {(draft.voiceScore * 100).toFixed(0)}</span>
              </>
            )}
            {draft.predictedPercentile !== null && (
              <>
                <span>·</span>
                <span>predicted p{Math.round(draft.predictedPercentile)}</span>
              </>
            )}
            <span>·</span>
            <span>created {formatTimestamp(draft.createdAt)}</span>
            {draft.publishedAt && (
              <>
                <span>·</span>
                <span>published {formatTimestamp(draft.publishedAt)}</span>
              </>
            )}
          </div>
        </div>

        {/* Approval actions — render only when the draft is awaiting
            human action AND has an approvalId pointing at the
            approvals row. The actions disappear after the decision
            lands (router.refresh re-runs this server component and
            the status moves out of PENDING_APPROVAL_STATUSES). */}
        {draft.approvalId && PENDING_APPROVAL_STATUSES.has(draft.status) && (
          <Card size="medium" tone="accent" className="mb-6">
            <div className="flex items-baseline justify-between gap-4 mb-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-text-primary">
                  pending your decision
                </span>
                <span className="text-xs text-text-tertiary">
                  Approve sends this draft to the publish pipeline. Deny
                  captures a lesson the team can recall on the next
                  related piece.
                </span>
              </div>
            </div>
            <ApprovalActions
              approvalId={draft.approvalId}
              draftId={draft.id}
            />
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Body — takes the wider 2-col cell on lg screens */}
          <Card size="medium" tone="default" className="lg:col-span-2">
            <CardHeader>
              <CardLabel>body</CardLabel>
              {draft.publishedUrl && (
                <a
                  href={draft.publishedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-text-secondary hover:text-text-primary rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
                  aria-label="Open published version in a new tab"
                >
                  open published →
                </a>
              )}
            </CardHeader>
            <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
              {draft.body}
            </p>
          </Card>

          {/* Recent metrics summary — narrow column. Phase A: a count
              + the latest engagement percentile. Sparklines lands in a
              follow-up that bucket-aggregates the metrics rows. */}
          <Card size="medium" tone="default">
            <CardHeader>
              <CardLabel>recent activity</CardLabel>
              <span className="text-xs text-text-tertiary font-mono tabular-nums">
                {metrics.length} snapshot{metrics.length === 1 ? "" : "s"}
              </span>
            </CardHeader>
            {metrics.length === 0 ? (
              <p className="text-sm text-text-tertiary leading-relaxed">
                No metric snapshots yet — <span className="font-mono">/ingest</span>{" "}
                writes here once the draft is published and the platform
                pollers start observing.
              </p>
            ) : (
              <div className="space-y-1.5 text-xs font-mono tabular-nums">
                <div className="text-text-tertiary">latest</div>
                <div className="flex justify-between">
                  <span className="text-text-secondary">at</span>
                  <span className="text-text-primary">
                    {formatTimestamp(metrics[0].snapshotAt)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary">platform</span>
                  <span className="text-text-primary">{metrics[0].platform}</span>
                </div>
                {metrics[0].engagementPercentile !== null && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">engagement p</span>
                    <span className="text-text-primary">
                      {Math.round(metrics[0].engagementPercentile)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-text-secondary">impressions</span>
                  <span className="text-text-primary">
                    {formatNum(metrics[0].impressions)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary">clicks</span>
                  <span className="text-text-primary">
                    {formatNum(metrics[0].clicks)}
                  </span>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Full snapshot history table — collapses to a stacked layout
            on narrow viewports (CSS handles it via overflow). */}
        {metrics.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-text-secondary mb-3 uppercase tracking-wide">
              snapshot history
            </h2>
            <div className="overflow-x-auto rounded border border-border-subtle">
              <table className="w-full text-xs font-mono tabular-nums">
                <thead className="bg-bg-elevated text-text-tertiary">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">at</th>
                    <th className="text-left px-3 py-2 font-medium">platform</th>
                    <th className="text-right px-3 py-2 font-medium">imp</th>
                    <th className="text-right px-3 py-2 font-medium">reach</th>
                    <th className="text-right px-3 py-2 font-medium">clk</th>
                    <th className="text-right px-3 py-2 font-medium">rxn</th>
                    <th className="text-right px-3 py-2 font-medium">cmt</th>
                    <th className="text-right px-3 py-2 font-medium">shr</th>
                    <th className="text-right px-3 py-2 font-medium">cnv</th>
                    <th className="text-right px-3 py-2 font-medium">eng p</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {metrics.map((m, idx) => (
                    <tr key={`${m.snapshotAt.toISOString()}-${m.platform}-${idx}`}>
                      <td className="px-3 py-1.5 text-text-secondary">
                        {formatTimestamp(m.snapshotAt)}
                      </td>
                      <td className="px-3 py-1.5 text-text-primary">{m.platform}</td>
                      <td className="px-3 py-1.5 text-right text-text-primary">
                        {formatNum(m.impressions)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-text-primary">
                        {formatNum(m.reach)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-text-primary">
                        {formatNum(m.clicks)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-text-primary">
                        {formatNum(m.reactions)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-text-primary">
                        {formatNum(m.comments)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-text-primary">
                        {formatNum(m.shares)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-text-primary">
                        {formatNum(m.conversions)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-text-primary">
                        {m.engagementPercentile === null
                          ? "—"
                          : Math.round(m.engagementPercentile)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-tertiary">
          <span className="font-mono tabular-nums break-all">{draft.id}</span>
          <span className="md:ml-auto">live · &lt;15s lag</span>
        </div>
      </div>
    </AppShell>
  );
}
