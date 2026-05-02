// /inbox — the full approval queue view. The seed creates 4
// awaiting_approval drafts + 2 in_review drafts; both statuses surface in
// the inbox per app/inbox/page.tsx PENDING_STATUSES filter.
//
// This test verifies:
//   - the page renders 4+ rows (matching the awaiting_approval count
//     minimum; 6 with in_review)
//   - clicking the first row navigates to /drafts/<uuid>
//   - the draft body renders on the destination page

import { test, expect } from "@playwright/test";

test("inbox lists pending drafts and links to detail", async ({ page }) => {
  await page.goto("/inbox");

  // Page header anchor.
  await expect(page.getByRole("heading", { name: "inbox", exact: true })).toBeVisible();

  // The inbox renders rows as <li><a href="/drafts/<id>"> — count those
  // anchors directly. The seed produces 4 awaiting_approval + 2 in_review
  // = 6 minimum; we assert >= 4 to leave headroom for future seed bumps.
  const draftLinks = page.locator('a[href^="/drafts/"]');
  await draftLinks.first().waitFor({ state: "visible" });
  const count = await draftLinks.count();
  expect(count).toBeGreaterThanOrEqual(4);

  // Click the first inbox row → expect /drafts/<uuid> URL + the body
  // section to render. The detail page uses CardLabel "body" as the
  // heading for the body card, which is a deterministic anchor.
  const firstHref = await draftLinks.first().getAttribute("href");
  expect(firstHref).toMatch(/^\/drafts\/[0-9a-fA-F-]{36}$/);

  await draftLinks.first().click();
  await expect(page).toHaveURL(/\/drafts\/[0-9a-fA-F-]{36}$/);

  // The detail page renders the body inside a Card whose CardLabel is "body".
  await expect(page.getByText("body", { exact: true })).toBeVisible();
});
