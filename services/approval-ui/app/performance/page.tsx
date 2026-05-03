// Doc 7 §workspace performance — KPI history dashboard.
//
// Aggregates post_metrics over a chosen window (7d / 30d / 12w) into:
//   - 4 hero KPI tiles (avg engagement percentile, CTR, reach, impressions)
//   - per-platform breakdown table
//   - weekly trend table with row-over-row deltas
//
// All reads run inside a single withTenant() transaction so the slice is
// internally consistent (RLS-scoped via session.activeCompanyId). Sparklines
// reuse the existing Sparkline component verbatim — bucket sizing changes
// with range so the chart always lands at a stable point count.
//
// Cold-start safe: empty windows render `—` on every tile + an empty-state
// card explaining where the data lands once /ingest writes its first row.
//
// Pattern source: app/page.tsx fetchHeroKpi (DATE_TRUNC week buckets) +
// fetchKpiMetrics (cross-table SUM aggregation). Same DATE_TRUNC + GROUP BY
// idiom via Drizzle's sql template tag, since Drizzle has no first-class
// window/grouping API for this shape.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUp, ArrowDown } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { MetricTile } from "@/components/mission-control/MetricTile";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/api/session";
import { withTenant } from "@/lib/db/client";
import { postMetrics } from "@/lib/db/schema/post-metrics";
import { asc, countDistinct, desc, gte, sql } from "drizzle-orm";

export const metadata: Metadata = {
  title: "Performance · Clipstack",
  description: "Workspace performance over time.",
};

type Range = "7d" | "30d" | "12w";

interface RangeConfig {
  label: Range;
  // Window length in days, used for the WHERE snapshot_at >= now() - Nd clause.
  days: number;
  // Bucket grain for sparklines + weekly-trend table.
  // 7d/30d → daily buckets; 12w → weekly buckets.
  bucket: "day" | "week";
  // Expected bucket count — used to pad missing buckets with 0 so the
  // sparkline arrays always have stable length.
  bucketCount: number;
}

const RANGES: Record<Range, RangeConfig> = {
  "7d":  { label: "7d",  days: 7,  bucket: "day",  bucketCount: 7 },
  "30d": { label: "30d", days: 30, bucket: "day",  bucketCount: 30 },
  "12w": { label: "12w", days: 84, bucket: "week", bucketCount: 12 },
};

function parseRange(raw: string | undefined): Range {
  if (raw === "7d" || raw === "30d" || raw === "12w") return raw;
  return "12w";
}

// Doc 8 §11.1 — reach/impressions abbreviated. Mirrors the same formatter
// used on Mission Control's reach·last-7d tile so the two surfaces read
// identically.
function formatReach(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

function formatInt(n: number): string {
  return new Intl.NumberFormat("en-US", { useGrouping: true }).format(
    Math.round(n),
  );
}

interface BucketRow {
  bucket: string;
  avgEngagement: number | null;
  sumImpressions: number;
  sumClicks: number;
  sumReach: number;
  draftCount: number;
}

interface PlatformRow {
  platform: string;
  drafts: number;
  impressions: number;
  clicks: number;
  reach: number;
  engagementPercentile: number | null;
}

interface WeeklyRow {
  week: string;
  drafts: number;
  impressions: number;
  clicks: number;
  engagementPercentile: number | null;
}

interface Aggregates {
  // Whole-window aggregates → KPI tile values.
  avgEngagement: number | null;
  sumImpressions: number;
  sumClicks: number;
  sumReach: number;
  // Bucketed series → KPI tile sparklines.
  buckets: BucketRow[];
  // Per-platform breakdown table.
  platforms: PlatformRow[];
  // Weekly trend table (always weekly, regardless of range — gives the
  // operator a consistent w/w view even on short ranges).
  weekly: WeeklyRow[];
}

const EMPTY_AGGREGATES: Aggregates = {
  avgEngagement: null,
  sumImpressions: 0,
  sumClicks: 0,
  sumReach: 0,
  buckets: [],
  platforms: [],
  weekly: [],
};

async function fetchAggregates(range: Range): Promise<Aggregates> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return EMPTY_AGGREGATES;

  const cfg = RANGES[range];
  const since = new Date(Date.now() - cfg.days * 24 * 60 * 60 * 1000);
  // The bucket grain is a literal we control — switching at the query
  // boundary because Drizzle's sql tag doesn't safely interpolate
  // identifiers / functions, only values.
  const truncBucket =
    cfg.bucket === "day"
      ? sql<string>`DATE_TRUNC('day', ${postMetrics.snapshotAt})::date`
      : sql<string>`DATE_TRUNC('week', ${postMetrics.snapshotAt})::date`;
  const truncWeek = sql<string>`DATE_TRUNC('week', ${postMetrics.snapshotAt})::date`;

  try {
    const result = await withTenant(companyId, async (tx) => {
      // Whole-window aggregates — drives the KPI tile values.
      const [headlineRow] = await tx
        .select({
          avgEngagement: sql<
            number | null
          >`AVG(${postMetrics.engagementPercentile})`,
          sumImpressions: sql<number>`COALESCE(SUM(${postMetrics.impressions}), 0)::float8`,
          sumClicks: sql<number>`COALESCE(SUM(${postMetrics.clicks}), 0)::float8`,
          sumReach: sql<number>`COALESCE(SUM(${postMetrics.reach}), 0)::float8`,
        })
        .from(postMetrics)
        .where(gte(postMetrics.snapshotAt, since));

      // Bucketed series — drives the 4 sparklines. One pass over the
      // window grouped by the chosen grain. Drafts column = COUNT(DISTINCT
      // draft_id) so a draft sampled twice in a bucket counts once.
      const bucketRows = await tx
        .select({
          bucket: truncBucket,
          avgEngagement: sql<
            number | null
          >`AVG(${postMetrics.engagementPercentile})`,
          sumImpressions: sql<number>`COALESCE(SUM(${postMetrics.impressions}), 0)::float8`,
          sumClicks: sql<number>`COALESCE(SUM(${postMetrics.clicks}), 0)::float8`,
          sumReach: sql<number>`COALESCE(SUM(${postMetrics.reach}), 0)::float8`,
          draftCount: countDistinct(postMetrics.draftId),
        })
        .from(postMetrics)
        .where(gte(postMetrics.snapshotAt, since))
        .groupBy(truncBucket)
        .orderBy(asc(truncBucket));

      // Per-platform breakdown. ORDER BY total impressions DESC matches
      // the operator's reading order — biggest channel first.
      const platformRows = await tx
        .select({
          platform: postMetrics.platform,
          drafts: countDistinct(postMetrics.draftId),
          impressions: sql<number>`COALESCE(SUM(${postMetrics.impressions}), 0)::float8`,
          clicks: sql<number>`COALESCE(SUM(${postMetrics.clicks}), 0)::float8`,
          reach: sql<number>`COALESCE(SUM(${postMetrics.reach}), 0)::float8`,
          engagementPercentile: sql<
            number | null
          >`AVG(${postMetrics.engagementPercentile})`,
        })
        .from(postMetrics)
        .where(gte(postMetrics.snapshotAt, since))
        .groupBy(postMetrics.platform)
        .orderBy(
          desc(sql<number>`COALESCE(SUM(${postMetrics.impressions}), 0)`),
        );

      // Weekly trend table — always weekly buckets so the operator gets
      // a consistent w/w surface even when the range is daily-bucketed
      // for the sparklines. Newest week first per spec.
      const weeklyRows = await tx
        .select({
          week: truncWeek,
          drafts: countDistinct(postMetrics.draftId),
          impressions: sql<number>`COALESCE(SUM(${postMetrics.impressions}), 0)::float8`,
          clicks: sql<number>`COALESCE(SUM(${postMetrics.clicks}), 0)::float8`,
          engagementPercentile: sql<
            number | null
          >`AVG(${postMetrics.engagementPercentile})`,
        })
        .from(postMetrics)
        .where(gte(postMetrics.snapshotAt, since))
        .groupBy(truncWeek)
        .orderBy(desc(truncWeek));

      return {
        headline: headlineRow,
        bucketRows,
        platformRows,
        weeklyRows,
      };
    });

    const headline = result.headline;
    const avgEngagement =
      headline?.avgEngagement === null || headline?.avgEngagement === undefined
        ? null
        : Number(headline.avgEngagement);

    const buckets: BucketRow[] = result.bucketRows.map((r) => ({
      bucket: String(r.bucket),
      avgEngagement:
        r.avgEngagement === null || r.avgEngagement === undefined
          ? null
          : Number(r.avgEngagement),
      sumImpressions: Number(r.sumImpressions ?? 0),
      sumClicks: Number(r.sumClicks ?? 0),
      sumReach: Number(r.sumReach ?? 0),
      draftCount: Number(r.draftCount ?? 0),
    }));

    const platforms: PlatformRow[] = result.platformRows.map((r) => ({
      platform: r.platform,
      drafts: Number(r.drafts ?? 0),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      reach: Number(r.reach ?? 0),
      engagementPercentile:
        r.engagementPercentile === null || r.engagementPercentile === undefined
          ? null
          : Number(r.engagementPercentile),
    }));

    const weekly: WeeklyRow[] = result.weeklyRows.map((r) => ({
      week: String(r.week),
      drafts: Number(r.drafts ?? 0),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      engagementPercentile:
        r.engagementPercentile === null || r.engagementPercentile === undefined
          ? null
          : Number(r.engagementPercentile),
    }));

    return {
      avgEngagement,
      sumImpressions: Number(headline?.sumImpressions ?? 0),
      sumClicks: Number(headline?.sumClicks ?? 0),
      sumReach: Number(headline?.sumReach ?? 0),
      buckets,
      platforms,
      weekly,
    };
  } catch {
    // Fail-soft: a bad query shouldn't 500 the page — render the
    // empty state instead so the operator still sees the layout.
    return EMPTY_AGGREGATES;
  }
}

// Pad sparkline arrays to bucketCount. Without this a 7d-bucketed sparkline
// would render with N points where N = days that actually had snapshots —
// the visual width would compress on sparse workspaces. Filling missing
// buckets with 0 keeps the chart stable + reads as "no data, not zero".
function padSeries(
  buckets: BucketRow[],
  pick: (b: BucketRow) => number,
  expected: number,
): number[] {
  const values = buckets.map(pick);
  if (values.length >= expected) return values.slice(-expected);
  return [...Array<number>(expected - values.length).fill(0), ...values];
}

function padEngagementSeries(
  buckets: BucketRow[],
  expected: number,
): number[] {
  const values = buckets.map((b) =>
    b.avgEngagement === null ? 0 : b.avgEngagement,
  );
  if (values.length >= expected) return values.slice(-expected);
  return [...Array<number>(expected - values.length).fill(0), ...values];
}

// CTR per bucket = SUM(clicks)/SUM(impressions). Treats divide-by-zero as
// 0 (rather than null) for the sparkline — the chart wants a number, not
// a gap. The KPI tile itself shows `—` when whole-window impressions are 0.
function ctrSeries(buckets: BucketRow[], expected: number): number[] {
  const values = buckets.map((b) =>
    b.sumImpressions > 0 ? b.sumClicks / b.sumImpressions : 0,
  );
  if (values.length >= expected) return values.slice(-expected);
  return [...Array<number>(expected - values.length).fill(0), ...values];
}

interface DeltaCellProps {
  // null = the cell has no value to display ("—"); the arrow is suppressed
  // regardless of prev. Using null + number lets the engagement column
  // (which can be missing per row) flow through the same component as the
  // always-present count columns without phantom arrow logic.
  value: number | null;
  prev: number | null | undefined;
  format: (n: number) => string;
}

// Row-over-row trend arrow for the weekly table. ▲ green if up, ▼ red if
// down, · neutral if unchanged. Arrow is suppressed entirely when either
// side of the comparison is missing — comparing 50 against a phantom 0
// (was-null) would lie about the trend.
function DeltaCell({ value, prev, format }: DeltaCellProps) {
  // Missing current value → "—" + no comparison.
  if (value === null) {
    return (
      <span className="font-mono tabular-nums text-text-tertiary">—</span>
    );
  }
  const display = format(value);
  // No prior or missing prior → render the value alone, no arrow.
  if (prev === undefined || prev === null) {
    return (
      <span className="font-mono tabular-nums text-text-primary">
        {display}
      </span>
    );
  }
  const diff = value - prev;
  if (diff === 0) {
    return (
      <span className="font-mono tabular-nums text-text-primary inline-flex items-center gap-1">
        {display}
        <span className="text-text-tertiary text-xs" aria-hidden>
          ·
        </span>
      </span>
    );
  }
  const tone = diff > 0 ? "text-status-success" : "text-status-danger";
  const Icon = diff > 0 ? ArrowUp : ArrowDown;
  return (
    <span className="font-mono tabular-nums text-text-primary inline-flex items-center gap-1">
      {display}
      <Icon className={`h-3 w-3 ${tone}`} aria-hidden />
    </span>
  );
}

function formatWeek(iso: string): string {
  // ISO date strings come back from DATE_TRUNC + ::date as YYYY-MM-DD.
  // Display as MMM-DD so it lines up with mono tabular-nums.
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

interface RangePillProps {
  range: Range;
  active: Range;
  label: string;
}

// Inline pill via Badge — variant="accent" on active, "outline" on
// inactive. Wrapping in a Link makes the pill the same shape on hover/
// focus as the rest of the navigation pills on /experiments. Each pill
// announces its range via aria-label so screen readers don't read
// "7d" as a meaningless token.
function RangePill({ range, active, label }: RangePillProps) {
  const isActive = range === active;
  return (
    <Link
      href={`/performance?range=${range}`}
      className="inline-block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 rounded-sm"
      aria-current={isActive ? "page" : undefined}
      aria-label={`Set range to ${label}${isActive ? " (current)" : ""}`}
    >
      <Badge variant={isActive ? "accent" : "outline"}>{label}</Badge>
    </Link>
  );
}

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const range = parseRange(params.range);
  const cfg = RANGES[range];
  const aggregates = await fetchAggregates(range);

  const hasData = aggregates.buckets.length > 0;

  // KPI tile values — `—` on cold start (no rows in window), formatted
  // values otherwise. Sparkline arrays are length-stable via padSeries.
  const engagementValue =
    aggregates.avgEngagement === null
      ? "—"
      : Math.round(aggregates.avgEngagement).toString();
  const ctrValue =
    aggregates.sumImpressions > 0
      ? `${((aggregates.sumClicks / aggregates.sumImpressions) * 100).toFixed(2)}%`
      : "—";
  const reachValue = hasData ? formatReach(aggregates.sumReach) : "—";
  const impressionsValue = hasData
    ? formatReach(aggregates.sumImpressions)
    : "—";

  const engagementSpark = hasData
    ? padEngagementSeries(aggregates.buckets, cfg.bucketCount)
    : [];
  const ctrSpark = hasData ? ctrSeries(aggregates.buckets, cfg.bucketCount) : [];
  const reachSpark = hasData
    ? padSeries(aggregates.buckets, (b) => b.sumReach, cfg.bucketCount)
    : [];
  const impressionsSpark = hasData
    ? padSeries(aggregates.buckets, (b) => b.sumImpressions, cfg.bucketCount)
    : [];

  return (
    <AppShell title="performance">
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors duration-fast mb-4 rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          mission control
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-text-primary mb-2">
            performance
          </h1>
          <p className="text-sm text-text-tertiary">
            Workspace performance over time. Engagement, CTR, reach, conversion
            percentiles aggregated weekly.
          </p>
        </div>

        {/* Range pills — three inline links above the KPI grid. The active
            pill takes accent tone; inactive read as outline. ?range= drives
            the whole page on the next request (server component). */}
        <div
          className="flex items-center gap-2 mb-6"
          role="group"
          aria-label="Performance time range"
        >
          <span className="text-xs uppercase tracking-wider text-text-tertiary mr-1">
            range
          </span>
          <RangePill range="7d" active={range} label="7d" />
          <RangePill range="30d" active={range} label="30d" />
          <RangePill range="12w" active={range} label="12w" />
        </div>

        {/* 4-up KPI tile grid. MetricTile already accepts trend?: number[]
            and tolerates an empty array — passing [] on cold start hides
            the sparkline cleanly without a separate render branch. */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <MetricTile
            label="avg engagement percentile"
            value={engagementValue}
            size="wide"
            tone="default"
            trend={engagementSpark}
            className="md:col-span-1"
          />
          <MetricTile
            label="avg ctr"
            value={ctrValue}
            size="wide"
            tone="default"
            trend={ctrSpark}
            className="md:col-span-1"
          />
          <MetricTile
            label="total reach"
            value={reachValue}
            size="wide"
            tone="default"
            trend={reachSpark}
            className="md:col-span-1"
          />
          <MetricTile
            label="total impressions"
            value={impressionsValue}
            size="wide"
            tone="default"
            trend={impressionsSpark}
            className="md:col-span-1"
          />
        </div>

        {!hasData && (
          <Card size="full" tone="default" className="mb-8">
            <div className="text-sm text-text-tertiary leading-relaxed">
              No metric snapshots in this window yet. Once /ingest writes the
              first post_metrics row, performance lands here.
            </div>
          </Card>
        )}

        {/* Per-platform breakdown — ordered by impressions DESC. Numeric
            cells use mono tabular-nums so columns align. */}
        {aggregates.platforms.length > 0 && (
          <Card size="full" tone="default" className="mb-8">
            <CardHeader>
              <CardLabel>per-platform breakdown</CardLabel>
              <span className="text-xs text-text-tertiary font-mono tabular-nums">
                {aggregates.platforms.length} platform
                {aggregates.platforms.length === 1 ? "" : "s"}
              </span>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle">
                    <th className="text-left py-2 pr-4 text-xs uppercase tracking-wider font-medium text-text-secondary">
                      platform
                    </th>
                    <th className="text-right py-2 px-3 text-xs uppercase tracking-wider font-medium text-text-secondary">
                      drafts
                    </th>
                    <th className="text-right py-2 px-3 text-xs uppercase tracking-wider font-medium text-text-secondary">
                      impressions
                    </th>
                    <th className="text-right py-2 px-3 text-xs uppercase tracking-wider font-medium text-text-secondary">
                      clicks
                    </th>
                    <th className="text-right py-2 px-3 text-xs uppercase tracking-wider font-medium text-text-secondary">
                      reach
                    </th>
                    <th className="text-right py-2 pl-3 text-xs uppercase tracking-wider font-medium text-text-secondary">
                      engagement_p
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {aggregates.platforms.map((p) => (
                    <tr key={p.platform}>
                      <td className="py-2 pr-4 text-text-primary">
                        {p.platform}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-text-primary">
                        {formatInt(p.drafts)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-text-primary">
                        {formatInt(p.impressions)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-text-primary">
                        {formatInt(p.clicks)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-text-primary">
                        {formatInt(p.reach)}
                      </td>
                      <td className="py-2 pl-3 text-right font-mono tabular-nums text-text-primary">
                        {p.engagementPercentile === null
                          ? "—"
                          : Math.round(p.engagementPercentile).toString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {aggregates.platforms.length === 0 && hasData && (
          <Card size="full" tone="default" className="mb-8">
            <CardHeader>
              <CardLabel>per-platform breakdown</CardLabel>
            </CardHeader>
            <div className="text-sm text-text-tertiary">
              No per-platform rows in this window.
            </div>
          </Card>
        )}

        {/* Weekly trend table — always weekly, ORDER BY week DESC. Each
            numeric cell shows value + a small trend arrow vs the next
            row down (i.e. the prior week chronologically). */}
        {aggregates.weekly.length > 0 ? (
          <Card size="full" tone="default" className="mb-8">
            <CardHeader>
              <CardLabel>weekly trend</CardLabel>
              <span className="text-xs text-text-tertiary font-mono tabular-nums">
                {aggregates.weekly.length} week
                {aggregates.weekly.length === 1 ? "" : "s"}
              </span>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle">
                    <th className="text-left py-2 pr-4 text-xs uppercase tracking-wider font-medium text-text-secondary">
                      week
                    </th>
                    <th className="text-right py-2 px-3 text-xs uppercase tracking-wider font-medium text-text-secondary">
                      drafts
                    </th>
                    <th className="text-right py-2 px-3 text-xs uppercase tracking-wider font-medium text-text-secondary">
                      impressions
                    </th>
                    <th className="text-right py-2 px-3 text-xs uppercase tracking-wider font-medium text-text-secondary">
                      clicks
                    </th>
                    <th className="text-right py-2 pl-3 text-xs uppercase tracking-wider font-medium text-text-secondary">
                      engagement_p
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {aggregates.weekly.map((w, i) => {
                    // Prior row (chronologically older) is the next index
                    // since the table is ordered DESC.
                    const prior = aggregates.weekly[i + 1];
                    return (
                      <tr key={w.week}>
                        <td className="py-2 pr-4 font-mono tabular-nums text-text-primary">
                          {formatWeek(w.week)}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <DeltaCell
                            value={w.drafts}
                            prev={prior?.drafts}
                            format={formatInt}
                          />
                        </td>
                        <td className="py-2 px-3 text-right">
                          <DeltaCell
                            value={w.impressions}
                            prev={prior?.impressions}
                            format={formatInt}
                          />
                        </td>
                        <td className="py-2 px-3 text-right">
                          <DeltaCell
                            value={w.clicks}
                            prev={prior?.clicks}
                            format={formatInt}
                          />
                        </td>
                        <td className="py-2 pl-3 text-right">
                          <DeltaCell
                            value={w.engagementPercentile}
                            prev={prior?.engagementPercentile ?? undefined}
                            format={(n) => Math.round(n).toString()}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          hasData && (
            <Card size="full" tone="default" className="mb-8">
              <CardHeader>
                <CardLabel>weekly trend</CardLabel>
              </CardHeader>
              <div className="text-sm text-text-tertiary">
                No weekly rollups available for this window.
              </div>
            </Card>
          )
        )}

        {/* Footer rail — surface the active range + provenance + freshness
            so the operator can tell the page apart from a stale tab. */}
        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-tertiary">
          <span className="font-mono tabular-nums">range: {range}</span>
          <span aria-hidden>·</span>
          <span>post_metrics aggregations</span>
          <span className="md:ml-auto">live · &lt;60s lag</span>
        </div>
      </div>
    </AppShell>
  );
}
