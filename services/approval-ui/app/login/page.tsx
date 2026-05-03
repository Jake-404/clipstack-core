// /login — minimal sign-in surface. Doc 8 design tokens; charcoal palette.
//
// Initial render: a single CTA that hits /api/auth/login (302s to WorkOS).
// On callback success the user lands wherever the `next` param pointed
// (defaults to / which is Mission Control).
//
// When WorkOS isn't configured on this deployment, /api/auth/login returns
// a 500 JSON envelope; the CTA has a hint to check WORKOS_API_KEY +
// WORKOS_CLIENT_ID env vars. AUTH_STUB users skip this surface entirely.

import { type Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sign in · Clipstack",
  description: "Sign in to your workspace.",
};

interface LoginPageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextParam = typeof params.next === "string" && params.next.startsWith("/")
    ? params.next
    : "/";
  const errorParam = typeof params.error === "string" ? params.error : null;

  const loginHref = `/api/auth/login?next=${encodeURIComponent(nextParam)}`;

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg-base px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="font-mono tabular-nums text-xs text-text-tertiary mb-2">
            clipstack
          </div>
          <h1 className="text-2xl font-semibold text-text-primary">Sign in</h1>
          <p className="mt-2 text-sm text-text-secondary">
            We use WorkOS to handle SSO and SAML.
          </p>
        </div>

        {errorParam && (
          <div
            role="alert"
            className="mb-4 px-3 py-2 rounded-md border border-status-danger/40 bg-status-danger/10 text-sm text-status-danger"
          >
            {errorParam}
          </div>
        )}

        <Link
          href={loginHref}
          className="block w-full text-center px-4 py-2.5 rounded-md bg-accent-500 text-text-inverted font-medium transition-colors duration-fast ease-default hover:bg-accent-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
        >
          Continue with WorkOS
        </Link>

        <div className="mt-6 text-center text-xs text-text-tertiary">
          Trouble signing in? Make sure your workspace owner has invited
          you with this email address.
        </div>
      </div>
    </main>
  );
}
