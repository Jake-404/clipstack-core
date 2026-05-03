// Placeholder for the Workspace surface — Doc 7 §6 (Agency / Brand Kit).
// Sidebar entry exists; this view ships when the brand-kit spec lands.
// The shell mirrors /experiments and /drafts so the navigation feels
// consistent rather than half-built.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Workspace · Clipstack",
  description: "Coming next.",
};

export default async function WorkspacePage() {
  return (
    <AppShell title="workspace">
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
            workspace
          </h1>
          <p className="text-sm text-text-tertiary">
            Your agency&apos;s brand identity. Tone, anti-tone, voice
            exemplars, glossary, banned words.
          </p>
        </div>

        <Card size="medium" tone="default">
          <p className="text-sm text-text-secondary leading-relaxed mb-4">
            The brand kit is where your voice lives. Every draft the
            Strategist generates pulls from these exemplars; the voice
            scorer measures cosine distance against them; the critic-reviser
            loop checks every line against your banned-word list before a
            draft enters the approval queue.
          </p>
          <ul className="space-y-1.5 text-sm text-text-secondary">
            <li>Edit voice exemplars that anchor every generation</li>
            <li>Manage banned-word and glossary lists per client</li>
            <li>Upload brand assets — logos, palettes, type, motion</li>
            <li>Per-client tone overrides for multi-brand agencies</li>
          </ul>
          <p className="mt-4 text-xs text-text-tertiary">
            Spec in flight. Roadmap +{" "}
            <span className="font-mono">core/docs/closed-loop.md</span>.
          </p>
        </Card>

        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-tertiary">
          <span className="font-mono tabular-nums">workspace</span>
          <span aria-hidden>·</span>
          <span>brand kit · in design</span>
          <span className="md:ml-auto">build your dream</span>
        </div>
      </div>
    </AppShell>
  );
}
