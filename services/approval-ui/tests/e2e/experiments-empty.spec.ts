// /experiments — bandit list view. Without a running bandit-orchestrator
// service (BANDIT_ORCH_BASE_URL unset, the default in seed-only test
// environments), fetchAllBandits returns [] and the page renders the
// empty-state copy.
//
// Verifies the empty-state sentence renders so we know the empty branch
// of the page is wired correctly.

import { test, expect } from "@playwright/test";

test("experiments page shows empty state when orchestrator is offline", async ({
  page,
}) => {
  await page.goto("/experiments");

  await expect(
    page.locator("main").getByRole("heading", { name: "experiments", exact: true }),
  ).toBeVisible();

  // Empty-state copy lives inside a Card with the sentence that opens
  // "No experiments registered yet." Match by partial text (the sentence
  // continues with explanation that includes inline <span> markup).
  await expect(page.getByText(/no experiments registered yet/i)).toBeVisible();
});
