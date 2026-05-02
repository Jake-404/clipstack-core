"use client";

// Custom runtime-error page. Next.js 15 contract: app/error.tsx must
// be a client component, receives ({ error, reset }) where error has an
// optional .digest (the production-safe error id Next stamps onto the
// stack trace + emits to telemetry), and reset() retries the failed
// route segment.
//
// Doc 8 voice: declarative, infrastructure-aware. The user sees what
// happened, sees the digest they can quote to support, and gets two
// recoveries (try again + go home). No jokey copy.

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, AlertOctagon, RotateCcw } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  // Surface to the browser console so devs working in Network/Sources
  // see the same digest the production telemetry sees. Production-safe:
  // Next sanitises .message at the framework boundary already.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[approval-ui] route error", error);
  }, [error]);

  const digest = error.digest;

  return (
    <AppShell title="error">
      <div className="flex items-center justify-center min-h-[60vh] p-6">
        <Card size="medium" tone="danger" className="max-w-md w-full">
          <div className="flex flex-col items-start gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-bg-elevated text-status-danger">
              <AlertOctagon className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary mb-2">
                Something broke.
              </h2>
              {digest && (
                <div className="mb-3">
                  <div className="text-xs uppercase tracking-wider text-text-tertiary mb-1">
                    error id
                  </div>
                  <div className="font-mono tabular-nums text-sm text-text-primary break-all">
                    {digest}
                  </div>
                </div>
              )}
              <p className="text-sm text-text-tertiary leading-relaxed">
                We've got a stack trace. If this keeps happening, send the
                digest above to support.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Button variant="primary" size="md" onClick={() => reset()}>
                <RotateCcw className="h-4 w-4" aria-hidden />
                Try again
              </Button>
              <Link href="/">
                <Button variant="secondary" size="md">
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Back to mission control
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
