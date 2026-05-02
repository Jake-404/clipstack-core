// /performance — KPI history dashboard. The seed creates 40 post_metrics
// snapshots across 4 published drafts, mostly within a 7d window, so
// loading ?range=7d should populate the headline tiles + per-platform
// table.
//
// Verifies:
//   - 4 KPI tiles render (avg engagement percentile, avg ctr, total reach,
//     total impressions)
//   - per-platform breakdown table renders with at least 1 row
//   - clicking the 30d range pill updates the URL

import { test, expect } from "@playwright/test";

test("performance page renders KPI tiles and switches range", async ({ page }) => {
  await page.goto("/performance?range=7d");

  await expect(page.getByRole("heading", { name: "performance", exact: true })).toBeVisible();

  // The 4 KPI tiles each render a CardLabel with the listed copy. The
  // MetricTile component renders the label as lowercase tracking-wider
  // text — getByText with exact match handles each one.
  await expect(page.getByText("avg engagement percentile", { exact: true })).toBeVisible();
  await expect(page.getByText("avg ctr", { exact: true })).toBeVisible();
  await expect(page.getByText("total reach", { exact: true })).toBeVisible();
  await expect(page.getByText("total impressions", { exact: true })).toBeVisible();

  // Per-platform breakdown: the section has a CardLabel "per-platform
  // breakdown" + a <table> with one <tbody><tr> per platform. The seed
  // publishes 4 drafts across 4 channels (linkedin, x, newsletter, blog)
  // so the table is guaranteed non-empty. Assert >= 1 row.
  await expect(page.getByText("per-platform breakdown", { exact: true })).toBeVisible();
  // Locate the platform table by header — the first <th> is "platform".
  // From there, count <tr> elements in the same <table>'s <tbody>.
  const platformTable = page
    .locator("table")
    .filter({ has: page.getByRole("columnheader", { name: "platform" }) })
    .first();
  await platformTable.waitFor({ state: "visible" });
  const platformRows = platformTable.locator("tbody tr");
  expect(await platformRows.count()).toBeGreaterThanOrEqual(1);

  // Range pill click: each pill is a <Link> wrapped in a Badge.
  // The "30d" pill has visible text "30d" inside an <a href> matching
  // /performance?range=30d. Clicking should navigate.
  const thirtyDayPill = page.getByRole("link", { name: "30d", exact: true });
  await thirtyDayPill.click();
  await expect(page).toHaveURL(/\/performance\?range=30d$/);
});
