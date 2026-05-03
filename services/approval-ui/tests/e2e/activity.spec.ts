// /activity — the audit-log feed. The seed creates 30 audit_log rows
// spread over the last 7 days. The page groups by date (YYYY-MM-DD)
// and renders newest-first.
//
// Verifies:
//   - at least one date-grouped section renders (groupByDate produces
//     <section>s with a YYYY-MM-DD heading)
//   - at least 5 audit rows are visible (the seed writes 30; we assert
//     a conservative floor)

import { test, expect } from "@playwright/test";

test("activity feed groups audit rows by date", async ({ page }) => {
  await page.goto("/activity");

  await expect(page.locator("main").getByRole("heading", { name: "activity", exact: true })).toBeVisible();

  // Each date section renders a YYYY-MM-DD heading inside <h2>. The seed
  // spreads events across the last 7 days so multiple date headings are
  // expected, but a single one is enough for the assertion.
  const dateHeading = page.locator("h2").filter({ hasText: /^\d{4}-\d{2}-\d{2}$/ });
  await dateHeading.first().waitFor({ state: "visible" });
  expect(await dateHeading.count()).toBeGreaterThanOrEqual(1);

  // Audit rows render as <li> elements inside the date sections. The
  // <ul class="divide-y..."> container holds them; counting the <li>
  // elements is the most stable assertion. We use a structural selector
  // rather than role-based since these aren't list-of-button rows.
  const auditRows = page.locator("section ul li");
  await auditRows.first().waitFor({ state: "visible" });
  const rowCount = await auditRows.count();
  expect(rowCount).toBeGreaterThanOrEqual(5);
});
