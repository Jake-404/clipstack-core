// Custom 404 page. Doc 8 voice — declarative, infrastructure-aware.
// Wraps in AppShell so the sidebar + topbar stay rendered (the user
// can still pivot back to a working URL via the nav). Centered card
// inside the main column.

import Link from "next/link";
import { ArrowLeft, MapPinOff } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function NotFound() {
  return (
    <AppShell title="not found">
      <div className="flex items-center justify-center min-h-[60vh] p-6">
        <Card size="medium" tone="default" className="max-w-md w-full">
          <div className="flex flex-col items-start gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-bg-elevated text-text-secondary">
              <MapPinOff className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary mb-1">
                404 — that page doesn't exist.
              </h2>
              <p className="text-sm text-text-tertiary leading-relaxed">
                If you bookmarked it, check the URL. Otherwise click below
                to go home.
              </p>
            </div>
            <Link href="/" className="mt-2">
              <Button variant="primary" size="md">
                <ArrowLeft className="h-4 w-4" aria-hidden />
                mission control
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
