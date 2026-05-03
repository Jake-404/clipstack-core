// Placeholder for the Workspace Settings surface.
// Sidebar entry exists; this view ships when the settings spec lands.
// The shell mirrors /experiments and /drafts so the navigation feels
// consistent rather than half-built.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Settings · Clipstack",
  description: "Coming next.",
};

export default async function SettingsPage() {
  return (
    <AppShell title="settings">
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
            settings
          </h1>
          <p className="text-sm text-text-tertiary">
            Workspace-level configuration. Approval thresholds,
            integrations, billing, retention.
          </p>
        </div>

        <Card size="medium" tone="default">
          <p className="text-sm text-text-secondary leading-relaxed mb-4">
            Settings is where the workspace tunes its own physics. The
            voice gates that decide what reaches a human, the integrations
            that turn approved drafts into published posts, the plan that
            governs what the meter is willing to spend, and how long the
            audit log remembers.
          </p>
          <ul className="space-y-1.5 text-sm text-text-secondary">
            <li>Voice score and percentile gates per channel</li>
            <li>Connected platform integrations and OAuth status</li>
            <li>Billing, plan, and metered-spend caps</li>
            <li>Audit-log retention and export</li>
          </ul>
          <p className="mt-4 text-xs text-text-tertiary">
            Spec in flight. Roadmap +{" "}
            <span className="font-mono">core/docs/closed-loop.md</span>.
          </p>
        </Card>

        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-tertiary">
          <span className="font-mono tabular-nums">settings</span>
          <span aria-hidden>·</span>
          <span>workspace config · in design</span>
          <span className="md:ml-auto">build your dream</span>
        </div>
      </div>
    </AppShell>
  );
}
