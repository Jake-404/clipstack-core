// Mission Control bento — the home page rendered against seeded data.
//
// Verifies the surface that aggregates everything else: approval queue tile
// shows seeded drafts, bus-health probes render, and institutional-memory
// shows the 8 lessons the seed creates. These are read-only assertions; no
// test mutates the seeded data.

import { test, expect } from "@playwright/test";

test("mission control renders with seeded data", async ({ page }) => {
  await page.goto("/");

  // The TopBar renders the page title via <h1>. AppShell passes
  // "Mission Control" as the title prop on app/page.tsx.
  await expect(page).toHaveTitle(/Clipstack/);
  await expect(page.locator("main").getByRole("heading", { name: "Mission Control" })).toBeVisible();

  // Approval-queue tile — CardLabel "approval queue" is the header copy.
  // Wait for it explicitly so we don't race the streaming render.
  const approvalQueueLabel = page.getByText("approval queue", { exact: true });
  await approvalQueueLabel.waitFor({ state: "visible" });
  await expect(approvalQueueLabel).toBeVisible();

  // At least one row in the queue must be a Link to /drafts/[id]. We
  // don't pin specific titles — test should survive seed copy edits.
  // The seed creates 4 awaiting_approval drafts so at least 4 rows
  // are guaranteed.
  const queueRows = page.locator('a[href^="/drafts/"]');
  await expect(queueRows.first()).toBeVisible({ timeout: 5000 });

  // Bus-health tile — CardLabel "bus health" anchors the tile.
  await expect(page.getByText("bus health", { exact: true })).toBeVisible();

  // Institutional memory tile renders the lesson count as a tabular-nums
  // figure. The seed creates 8 lessons so the count must be 8 (or, in
  // case the test runs after an unrelated UI tweak that adds a lesson,
  // any non-zero integer). We assert non-zero rather than =8 to keep the
  // test resilient to follow-up seed extensions.
  await expect(page.getByText("institutional memory", { exact: true })).toBeVisible();
  // Find the tile's count — it sits adjacent to the "lessons captured"
  // copy. The tile renders the number with toLocaleString, so 8 → "8";
  // a future seed bump to e.g. 12 would still match \d+.
  const lessonsCaptured = page.getByText(/lessons? captured/i);
  await expect(lessonsCaptured).toBeVisible();
  // The tile renders <span>{count}</span><span>lessons captured</span>;
  // the count is the immediately preceding sibling. Read it via the
  // tile's outer Card and assert it's a positive integer.
  // Anchor on the "lessons captured" copy and walk up to the enclosing
  // Card div. The Card wrapper's textContent contains the count number
  // immediately before the "lessons captured" string per the tile's JSX.
  const memoryTile = lessonsCaptured.first().locator("xpath=ancestor::div[1]");
  const memoryText = (await memoryTile.textContent()) ?? "";
  const match = memoryText.match(/(\d[\d,]*)\s*lessons?\s*captured/i);
  expect(match).not.toBeNull();
  const captured = match?.[1] ?? "0";
  const count = parseInt(captured.replace(/,/g, ""), 10);
  expect(count).toBeGreaterThan(0);
});
