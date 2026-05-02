// Placeholder for the Content Calendar surface — Doc 4 §3.
// Sidebar entry exists; this view ships when the scheduling spec lands.
// The shell mirrors /experiments and /drafts so the navigation feels
// consistent rather than half-built.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";

export default async function CalendarPage() {
  return (
    <AppShell title="calendar">
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
            calendar
          </h1>
          <p className="text-sm text-text-tertiary">
            What&apos;s scheduled to ship across every channel, when, and to
            which audience.
          </p>
        </div>

        <Card size="medium" tone="default">
          <p className="text-sm text-text-secondary leading-relaxed mb-4">
            The calendar is the single source of truth for what goes live
            and when. Every approved draft lands on a slot; every channel
            adapter pulls from the same plan; conflicts surface before they
            ship rather than after.
          </p>
          <ul className="space-y-1.5 text-sm text-text-secondary">
            <li>Drag-and-drop scheduling across channels and clients</li>
            <li>Per-channel and per-client filters with saved views</li>
            <li>Conflict detection — overlap, cadence, audience clash</li>
            <li>Bulk reschedule when a launch date shifts</li>
          </ul>
          <p className="mt-4 text-xs text-text-tertiary">
            Coming next — track progress in{" "}
            <span className="font-mono">core/docs/closed-loop.md</span>.
          </p>
        </Card>

        <div className="mt-8 flex items-center gap-4 text-xs text-text-tertiary">
          <span className="font-mono tabular-nums">calendar</span>
          <span>·</span>
          <span>placeholder</span>
          <span>·</span>
          <span>ships when spec lands</span>
        </div>
      </div>
    </AppShell>
  );
}
