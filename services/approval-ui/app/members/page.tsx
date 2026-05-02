// Placeholder for the Team Members surface — RBAC.
// Sidebar entry exists; this view ships when the membership UI spec lands.
// The shell mirrors /experiments and /drafts so the navigation feels
// consistent rather than half-built.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";

export default async function MembersPage() {
  return (
    <AppShell title="members">
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
            members
          </h1>
          <p className="text-sm text-text-tertiary">
            Who&apos;s on the team and what they can do. RBAC roles,
            invitations, audit visibility.
          </p>
        </div>

        <Card size="medium" tone="default">
          <p className="text-sm text-text-secondary leading-relaxed mb-4">
            Membership is the trust layer for everything else. Roles
            determine who can approve a draft, who can rewire a bandit,
            who can read the audit log. The roster lives here; every
            mutation lands in the audit trail.
          </p>
          <ul className="space-y-1.5 text-sm text-text-secondary">
            <li>Invite teammates via email or SSO domain claim</li>
            <li>
              Manage RBAC roles — owner, approver, contributor, viewer
            </li>
            <li>Per-client access scoping for agency teams</li>
            <li>Suspend or remove members with revocation audit</li>
          </ul>
          <p className="mt-4 text-xs text-text-tertiary">
            Spec in flight. Roadmap +{" "}
            <span className="font-mono">core/docs/closed-loop.md</span>.
          </p>
        </Card>

        <div className="mt-8 flex items-center gap-4 text-xs text-text-tertiary">
          <span className="font-mono tabular-nums">members</span>
          <span>·</span>
          <span>RBAC · in design</span>
          <span className="ml-auto">build your dream</span>
        </div>
      </div>
    </AppShell>
  );
}
