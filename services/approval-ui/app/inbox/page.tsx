// /inbox — full approval queue, expanded from Mission Control's
// ApprovalQueueTile. Same query shape as fetchApprovalQueue() in
// app/page.tsx but with no LIMIT, grouped by channel for legibility.
//
// Doc 4 §4.1 calls for a mobile swipe queue here too; this server
// component renders the universal list view first — the swipe layer
// is its own slice and lives on top of the same data contract.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { asc, eq, inArray } from "drizzle-orm";

import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  AgentMark,
  type AgentMarkColor,
  type AgentMarkShape,
} from "@/components/AgentMark";
import { getSession } from "@/lib/api/session";
import { withTenant } from "@/lib/db/client";
import { agents as agentsTable } from "@/lib/db/schema/agents";
import { drafts } from "@/lib/db/schema/drafts";

export const metadata: Metadata = {
  title: "Inbox · Clipstack",
  description: "Drafts awaiting your decision.",
};

// Agent role → AgentMark visual mapping. Doc 8 §5.6 — every role
// has a stable (shape, color) so the same agent reads the same way
// across surfaces. Copied verbatim from app/page.tsx so the inbox
// list matches the Mission Control tile pixel-for-pixel; if either
// drifts, the same agent stops looking like the same agent.
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

interface InboxRow {
  id: string;
  title: string;
  channel: string;
  createdAt: Date;
  predictedPercentile: number | null;
  agentLabel: string;
  agentShape: AgentMarkShape;
  agentColor: AgentMarkColor;
}

async function fetchInbox(): Promise<InboxRow[]> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return [];

  const PENDING_STATUSES = ["awaiting_approval", "in_review"] as const;

  try {
    return await withTenant(companyId, async (tx) => {
      // No LIMIT here — the inbox is the place the user goes to see
      // everything. Tile gets the top 4; this gets the full set.
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
        .orderBy(asc(drafts.createdAt));

      return rows.map((row) => {
        const viz = AGENT_ROLE_VIZ[row.agentRole ?? ""] ?? {
          shape: "circle" as const,
          color: "slate" as const,
        };
        const label =
          (row.agentDisplayName ?? "?").trim().charAt(0).toUpperCase() ||
          "?";
        return {
          id: row.id,
          title: row.title?.trim() || "(untitled draft)",
          channel: row.channel,
          createdAt: row.createdAt,
          // Keep the null distinct from 0 — the tile renders 0 as the
          // worst-case "danger" tone, but here we want to flag "not
          // yet predicted" with a neutral `p—` instead of misreading
          // a cold draft as catastrophic.
          predictedPercentile: row.predictedPercentile,
          agentLabel: label,
          agentShape: viz.shape,
          agentColor: viz.color,
        };
      });
    });
  } catch {
    return [];
  }
}

function formatAge(createdAt: Date): string {
  const elapsed = Date.now() - createdAt.getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatCreatedAgo(createdAt: Date): string {
  const elapsed = Date.now() - createdAt.getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `created ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `created ${hours}h ago`;
  return `created ${Math.floor(hours / 24)}d ago`;
}

export default async function InboxPage() {
  const items = await fetchInbox();

  // Group by channel; oldest-first within group is preserved by the
  // ORDER BY in the query (rows arrive sorted, the reduce keeps that
  // order). Section headers sort alphabetically so the page reads the
  // same on every refresh — channel order is the user's mental index.
  const byChannel = items.reduce<Record<string, InboxRow[]>>((acc, row) => {
    (acc[row.channel] ??= []).push(row);
    return acc;
  }, {});
  const channels = Object.keys(byChannel).sort();

  return (
    <AppShell title="inbox">
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors duration-fast mb-4 rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          mission control
        </Link>

        <div className="mb-6">
          {/* Visually a page-title; semantically an h2 because the
              persistent TopBar already provides the canonical h1 with
              the same text. Keeps the heading order valid. */}
          <h2 className="text-2xl font-semibold text-text-primary mb-2">
            inbox
          </h2>
          <p className="text-sm text-text-tertiary">
            Drafts awaiting your decision. Oldest first — highest urgency
            at the top.
          </p>
        </div>

        {items.length === 0 ? (
          <Card size="medium" tone="default">
            <div className="text-sm text-text-tertiary leading-relaxed">
              No drafts awaiting decision. The queue populates when an
              agent registers a piece for review.
            </div>
          </Card>
        ) : (
          // data-keyboard-list marks this scope as J/K-navigable. The
          // global <KeyboardShortcuts /> listener picks up every
          // [data-keyboard-row] descendant in document order and focus-
          // cycles through them — which spans channel groups cleanly,
          // since the rows themselves carry the marker.
          <div className="space-y-6" data-keyboard-list>
            {channels.map((channel) => {
              const group = byChannel[channel];
              return (
                <section key={channel}>
                  <div className="flex items-baseline gap-2 mb-2 pb-1 border-b border-border-subtle">
                    <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                      {channel}
                    </h3>
                    <span className="text-xs text-text-tertiary font-mono tabular-nums">
                      {group.length}
                    </span>
                  </div>
                  <ul className="divide-y divide-border-subtle">
                    {group.map((row) => {
                      // p— gets the neutral "default" badge so the
                      // user reads it as "no prediction yet", not as
                      // "catastrophic". Only resolved numbers map
                      // onto the success/warning/danger tone scale.
                      const p = row.predictedPercentile;
                      const pTone =
                        p === null
                          ? "default"
                          : p >= 70
                            ? "success"
                            : p >= 50
                              ? "warning"
                              : "danger";
                      const pLabel =
                        p === null ? "p—" : `p${Math.round(p)}`;
                      return (
                        <li key={row.id}>
                          <Link
                            href={`/drafts/${row.id}`}
                            data-keyboard-row
                            className="flex items-center gap-3 py-3 hover:bg-bg-elevated transition-colors duration-fast -mx-2 px-2 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
                          >
                            <AgentMark
                              shape={row.agentShape}
                              color={row.agentColor}
                              size="sm"
                              title={row.agentLabel}
                              initial={row.agentLabel}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm text-text-primary truncate">
                                {row.title}
                              </div>
                              <div className="text-xs text-text-tertiary">
                                <span>{row.channel}</span>
                                <span className="mx-1.5">·</span>
                                <span className="font-mono tabular-nums">
                                  {formatAge(row.createdAt)}
                                </span>
                                <span className="mx-1.5">·</span>
                                <span>{formatCreatedAgo(row.createdAt)}</span>
                              </div>
                            </div>
                            <Badge
                              variant={pTone}
                              className="font-mono tabular-nums shrink-0"
                            >
                              {pLabel}
                            </Badge>
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
            {items.length} total
          </span>
          <span aria-hidden>·</span>
          <span>approval queue</span>
          <span className="md:ml-auto">live · &lt;15s lag</span>
        </div>
      </div>
    </AppShell>
  );
}
