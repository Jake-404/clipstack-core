// Workspace audit-log feed. Every approve/deny/lesson-recall/post-metrics
// write/etc. has been writing audit_log rows; this page is where they
// surface for humans. Newest-first, grouped by date for legibility — when
// a workspace is producing dozens of events a day, scrolling by day reads
// cleaner than a flat firehose.
//
// All actor display happens via two LEFT JOINs (users + agents) keyed off
// actorKind. The 'system' actor has no row to join, so its display falls
// back to the literal "system" string in the row renderer.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { and, desc, eq, sql } from "drizzle-orm";

import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getSession } from "@/lib/api/session";
import { withTenant } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema/audit";
import { agents } from "@/lib/db/schema/agents";
import { users } from "@/lib/db/schema/users";

const ROW_LIMIT = 100;

type ActorKind = "user" | "agent" | "system";

interface ActivityRow {
  id: string;
  kind: string;
  actorKind: ActorKind;
  actorId: string | null;
  detailsJson: Record<string, unknown> | null;
  occurredAt: Date;
  userEmail: string | null;
  agentDisplayName: string | null;
}

async function fetchActivity(): Promise<ActivityRow[]> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return [];

  try {
    const rows = await withTenant(companyId, async (tx) =>
      tx
        .select({
          id: auditLog.id,
          kind: auditLog.kind,
          actorKind: auditLog.actorKind,
          actorId: auditLog.actorId,
          detailsJson: auditLog.detailsJson,
          occurredAt: auditLog.occurredAt,
          userEmail: users.email,
          agentDisplayName: agents.displayName,
        })
        .from(auditLog)
        // The two LEFT JOINs each gate on actorKind so a stray cross-table
        // match (e.g. a user UUID that happens to coincide with an agent
        // UUID) can't bleed display names across actor classes.
        //
        // auditLog.actorId is TEXT (so 'system' actors with no row to
        // reference are still representable) while users.id / agents.id
        // are UUID. Postgres has no implicit text↔uuid cast, so the join
        // condition uses an explicit ::uuid cast inside a guard that
        // skips rows whose actor_id isn't a valid UUID — that way a
        // 'system' actor (actor_id NULL or non-UUID string) matches
        // neither side rather than blowing up the whole query.
        .leftJoin(
          users,
          and(
            eq(auditLog.actorKind, "user"),
            sql`${auditLog.actorId} IS NOT NULL AND ${auditLog.actorId} ~ '^[0-9a-fA-F-]{36}$' AND ${auditLog.actorId}::uuid = ${users.id}`,
          ),
        )
        .leftJoin(
          agents,
          and(
            eq(auditLog.actorKind, "agent"),
            sql`${auditLog.actorId} IS NOT NULL AND ${auditLog.actorId} ~ '^[0-9a-fA-F-]{36}$' AND ${auditLog.actorId}::uuid = ${agents.id}`,
          ),
        )
        .orderBy(desc(auditLog.occurredAt))
        .limit(ROW_LIMIT),
    );

    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      actorKind: r.actorKind as ActorKind,
      actorId: r.actorId,
      detailsJson: r.detailsJson,
      occurredAt: r.occurredAt,
      userEmail: r.userEmail,
      agentDisplayName: r.agentDisplayName,
    }));
  } catch {
    // Fail-soft: an audit-log read failure shouldn't 500 the page. The
    // empty state reads as "no activity yet" — a logged warning would be
    // ideal once the service has a structured logger wired in.
    return [];
  }
}

// Kind → tone mapping. Outcomes (success/failure) drive the tone; neutral
// recall/list events are info; everything else falls back to default so
// the visual noise stays low.
type BadgeVariant =
  | "default"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "outline";

function kindVariant(kind: string): BadgeVariant {
  if (kind === "approval.approved" || kind.endsWith(".approved")) {
    return "success";
  }
  if (
    kind === "approval.denied" ||
    kind.endsWith(".denied") ||
    kind.endsWith(".failed")
  ) {
    return "danger";
  }
  if (kind.endsWith(".recalled") || kind.endsWith(".listed")) {
    return "info";
  }
  return "default";
}

function actorKindVariant(actorKind: ActorKind): BadgeVariant {
  switch (actorKind) {
    case "user":
      return "info";
    case "agent":
      return "accent";
    case "system":
      return "default";
  }
}

function actorDisplayName(row: ActivityRow): string {
  if (row.userEmail) {
    const local = row.userEmail.split("@")[0];
    if (local) return local;
  }
  if (row.agentDisplayName) return row.agentDisplayName;
  if (row.actorId) return row.actorId.slice(0, 8);
  return "system";
}

// Pad to two digits without depending on Intl.DateTimeFormat — keeps the
// formatting consistent regardless of the server runtime's default locale.
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(
    d.getUTCDate(),
  )}`;
}

function formatHHMM(d: Date): string {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

// Keys that may carry free-text user content or PII and must NEVER reach
// the activity feed verbatim. Audit writers that need to record one of
// these should store a length / hash / id instead — see the existing
// `emailLength` and `rationaleLength` patterns in the auth-callback and
// approve/deny routes. Any unrecognised key whose value looks like an
// email also gets redacted by the value-shape check below.
const DETAILS_KEY_DENYLIST = new Set<string>([
  "rationale",
  "denyRationale",
  "email",
  "user_email",
  "userEmail",
  "name",
  "fullName",
  "phone",
  "phoneNumber",
  "address",
  "ip",
  "ipAddress",
  "body",
  "text",
  "draftBody",
  "transcript",
  "secret",
  "token",
  "apiKey",
  "password",
  "credential",
]);

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Format detailsJson as `key=value · key=value`, mono. Nullish values are
// dropped; objects/arrays serialize via JSON so a nested payload still
// reads as a single value cell rather than "[object Object]". Each value
// caps at 60 chars so a long URL or transcript snippet can't blow up the
// row height. Values whose KEYS match the denylist are redacted to
// `key=•redacted` and values that LOOK like emails are masked locally so
// activity browsing can never accidentally surface human PII even if a
// future writer forgets the length-only convention.
function formatDetails(
  details: Record<string, unknown> | null,
): string | null {
  if (!details) return null;
  const entries = Object.entries(details).filter(
    ([, v]) => v !== null && v !== undefined,
  );
  if (entries.length === 0) return null;

  const parts = entries.map(([k, v]) => {
    if (DETAILS_KEY_DENYLIST.has(k)) {
      return `${k}=•redacted`;
    }
    let raw: string;
    if (typeof v === "string") {
      raw = EMAIL_SHAPE.test(v)
        ? `${v.split("@")[0]}@…`
        : v;
    } else if (typeof v === "number" || typeof v === "boolean") {
      raw = String(v);
    } else {
      try {
        raw = JSON.stringify(v);
      } catch {
        raw = String(v);
      }
    }
    return `${k}=${truncate(raw, 60)}`;
  });
  return parts.join(" · ");
}

interface DateGroup {
  date: string;
  rows: ActivityRow[];
}

function groupByDate(rows: ActivityRow[]): DateGroup[] {
  const map = new Map<string, ActivityRow[]>();
  for (const r of rows) {
    const key = formatDateKey(r.occurredAt);
    const list = map.get(key);
    if (list) {
      list.push(r);
    } else {
      map.set(key, [r]);
    }
  }
  // Map preserves insertion order; rows are already desc(occurredAt),
  // so the keys come out newest-first naturally.
  return Array.from(map.entries()).map(([date, groupRows]) => ({
    date,
    rows: groupRows,
  }));
}

export default async function ActivityPage() {
  const rows = await fetchActivity();
  const groups = groupByDate(rows);

  return (
    <AppShell title="activity">
      <div className="p-6 max-w-5xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors duration-fast mb-4"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          mission control
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-text-primary mb-2">
            activity
          </h1>
          <p className="text-sm text-text-tertiary">
            Every action your team and agents have taken. Newest first.
          </p>
        </div>

        {rows.length === 0 ? (
          <Card size="medium" tone="default">
            <div className="text-sm text-text-tertiary leading-relaxed">
              No activity recorded yet. The first time an agent runs a
              tool or a user takes an action, it lands here.
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.date}>
                <div className="flex items-baseline gap-2 mb-2 pb-1 border-b border-border-subtle">
                  <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide font-mono tabular-nums">
                    {group.date}
                  </h2>
                  <span className="text-xs text-text-tertiary font-mono tabular-nums">
                    {group.rows.length} events
                  </span>
                </div>
                <ul className="divide-y divide-border-subtle">
                  {group.rows.map((row) => {
                    const details = formatDetails(row.detailsJson);
                    return (
                      <li
                        key={row.id}
                        className="flex items-start gap-3 py-3"
                      >
                        <span className="text-xs text-text-tertiary font-mono tabular-nums shrink-0 w-12 pt-0.5">
                          {formatHHMM(row.occurredAt)}
                        </span>
                        <Badge
                          variant={actorKindVariant(row.actorKind)}
                          className="shrink-0"
                        >
                          {row.actorKind}
                        </Badge>
                        <span className="text-sm text-text-primary shrink-0 truncate max-w-[12rem]">
                          {actorDisplayName(row)}
                        </span>
                        <Badge
                          variant={kindVariant(row.kind)}
                          className="shrink-0 font-mono"
                        >
                          {row.kind}
                        </Badge>
                        {details && (
                          <span className="text-xs text-text-tertiary font-mono truncate min-w-0 flex-1 pt-1">
                            {details}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        <div className="mt-8 flex items-center gap-4 text-xs text-text-tertiary">
          <span className="font-mono tabular-nums">
            showing {rows.length} of last {ROW_LIMIT}
          </span>
          <span>·</span>
          <span>audit log</span>
          <span className="ml-auto">live · &lt;15s lag</span>
        </div>
      </div>
    </AppShell>
  );
}
