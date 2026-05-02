// Playwright configuration for approval-ui Mission Control E2E tests.
//
// Tests live in `tests/e2e/` and run against the local Next.js dev server
// brought up via the webServer block. CI applies migrations + runs the seed
// before invoking `pnpm exec playwright test`, so every test starts from
// the deterministic state the seed-demo.ts script writes (DEMO_USER_ID
// resolves through AUTH_STUB → seeded "Demo Workspace" tenant).
//
// chromium-only for now; firefox/webkit can land later once the tests
// stabilize on a single engine. fullyParallel=true is safe because every
// test is read-only against the seeded data — no test mutates state another
// test depends on (the deny test types in the textarea but never submits).

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  // 'list' is the CI-friendly reporter — one line per test, exit code from
  // the count of failures, no HTML server attempting to open in CI.
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    // Capture trace only on retry — keeps the happy-path runs fast while
    // still giving operators a debug bundle when something flakes.
    trace: "on-first-retry",
    headless: true,
  },
  webServer: {
    // Boot the dev server fresh if nothing's listening on :3000; otherwise
    // reuse whatever the operator already has running. 60s is generous for
    // Next.js cold-start on CI runners.
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
