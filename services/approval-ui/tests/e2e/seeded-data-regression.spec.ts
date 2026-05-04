// Regression test for the silent-fail SQL bug class.
//
// We hit two production bugs in the same week (commits 2149e45 + 35e1a87)
// where a query inside a server-component fetcher threw at runtime and
// landed in the fetcher's `catch` block, which returned an empty array /
// zeroed object as the fail-soft fallback. The tile then rendered its
// empty-state, the page looked clean, and the bug stayed silent for weeks
// because every existing e2e test asserted "either rows OR empty state is
// visible" — i.e. the test passed when the bug was active.
//
// The two bug shapes:
//
//   1. Date-binding in raw `sql\`\`` templates (fetchHeroKpi + fetchLessonStats):
//      `${dateObject}` in a raw template position throws TypeError because
//      postgres-js doesn't auto-bind Date there (it does in drizzle helper
//      operators like `gte()`/`lte()`, hence the asymmetry that masked the
//      bug). Fix: pass `${date.toISOString()}::timestamptz`.
//
//   2. Postgres ::uuid cast eager evaluation (fetchActivity):
//      `actor_id ~ '^uuid-regex$' AND actor_id::uuid = users.id` throws on
//      non-UUID actor_id rows ('system' for system events) because the cast
//      isn't short-circuited by the AND. Fix: `(CASE WHEN regex THEN cast
//      ELSE NULL END) = users.id`.
//
// What this test asserts (and how it catches both bug classes):
//
//   - The seed creates deterministic data in the demo workspace: 8 lessons
//     (5 within 7 days), 11 drafts (6 pending + 4 published + 1 denied),
//     30 audit rows over 7 days, 40 post_metrics rows.
//   - Each test below asserts that the *seeded data is actually rendered*,
//     and explicitly that the empty-state copy is NOT visible. If either
//     bug class returns, the page falls back to its empty state and the
//     `expect(emptyState).not.toBeVisible()` assertion fails loud + fast.
//
// If you're tempted to soften an assertion here because "the seed should
// flex / CI is sometimes flaky" — please don't. The whole point of this
// file is that loose assertions hid the bug class for weeks. If a seed
// edit breaks an assertion, update the count; don't replace it with an
// "or empty" fallback.

import { test, expect } from "@playwright/test";

test.describe("seeded-data regression — silent-fail SQL bug class", () => {
  test("Mission Control hero + memory tiles reflect seeded data (catches Date-binding in fetchHeroKpi + fetchLessonStats)", async ({
    page,
  }) => {
    await page.goto("/");

    // Seed publishes 4 drafts within the last 6 days. fetchHeroKpi's
    // `weeklyShipped` query bounds by `gte(drafts.publishedAt, sevenDaysAgo)`
    // which is a drizzle helper — that path always worked. But the same
    // fetcher's "lastWeek" branch uses raw `sql\`${date}\`` interpolation;
    // when *that* throws, the whole try block rolls back to the empty
    // fallback `{ predicted: 50, delta: 0, trend: [], weeklyShipped: 0 }`.
    //
    // Seed inserts exactly 8 lessons; fetchLessonStats reads them via a
    // single triple-aggregate SELECT with a `COUNT(*) FILTER (WHERE
    // captured_at >= ${date}::timestamptz)` clause. Pre-fix that clause
    // had a raw `${dateObject}` and silently threw — the catch returned
    // `{ totalCount: 0, thisWeekCount: 0, clientScopedCount: 0 }` and the
    // tile rendered "0 lessons captured" against a populated DB.
    //
    // We grab the rendered page's innerText (whitespace-collapsed, flex-
    // gap aware) and parse the two counts with regexes. innerText is
    // more robust than getByText's element-scoped matching for copy
    // that spans adjacent <span>s with stripped JSX whitespace.
    await expect(
      page.locator("main").getByRole("heading", { name: "Mission Control" }),
    ).toBeVisible();
    await expect(
      page.getByText("institutional memory", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/shipped this week:/i)).toBeVisible();

    const bodyText = await page.locator("main").innerText();

    const shippedMatch = bodyText.match(/shipped this week:\s*(\d+)/i);
    expect(
      shippedMatch,
      "shipped-this-week tile structure changed — this regression test needs updating",
    ).toBeTruthy();
    expect(
      Number(shippedMatch?.[1] ?? 0),
      "weeklyShipped is 0 — fetchHeroKpi probably hit its catch block",
    ).toBeGreaterThanOrEqual(1);

    // The lessons tile renders "{N}\nlessons captured" with the count
    // and label in adjacent <span>s. innerText preserves the visual
    // whitespace from the flex `gap-2`, so the regex uses `\s*` to be
    // tolerant of either a literal space or a newline between them.
    const lessonsMatch = bodyText.match(/(\d+)\s*lessons?\s+captured/i);
    expect(
      lessonsMatch,
      "lessons-captured copy not found — InstitutionalMemoryTile structure changed?",
    ).toBeTruthy();
    expect(
      Number(lessonsMatch?.[1] ?? 0),
      "totalCount is 0 — fetchLessonStats probably hit its catch block",
    ).toBeGreaterThanOrEqual(1);
  });

  test("Activity feed renders seeded audit rows (catches UUID-cast eager-eval in fetchActivity)", async ({
    page,
  }) => {
    await page.goto("/activity");

    await expect(
      page.locator("main").getByRole("heading", { name: "activity", exact: true }),
    ).toBeVisible();

    // The seed inserts 30 audit_log rows split across actor_kind values.
    // Roughly a third land with actor_kind='system' + actor_id='system'
    // (a non-UUID literal). Pre-fix, the LEFT JOIN to users on
    // `actor_id::uuid = users.id` threw on the non-UUID rows, the catch
    // fired, and fetchActivity returned []. The page then rendered the
    // "No activity recorded yet" empty state against a populated DB.
    //
    // Two mutually exclusive assertions: at least one audit row is
    // visible AND the empty state is not. The "or" form (current
    // activity.spec.ts) was the loophole that hid the bug.
    const emptyState = page.getByText("No activity recorded yet");
    await expect(
      emptyState,
      "empty state visible — fetchActivity probably hit its catch block",
    ).not.toBeVisible();
    const auditRows = page.locator("section ul li");
    await expect(auditRows.first()).toBeVisible({ timeout: 5000 });
    const rowCount = await auditRows.count();
    expect(
      rowCount,
      "audit row count below seeded floor — fetchActivity returned a partial list?",
    ).toBeGreaterThanOrEqual(5);
  });

  test("Inbox renders seeded pending drafts (catches any future fail-soft in fetchInbox)", async ({
    page,
  }) => {
    await page.goto("/inbox");

    await expect(
      page.locator("main").getByRole("heading", { name: "inbox", exact: true }),
    ).toBeVisible();

    // Seed creates 4 awaiting_approval + 2 in_review = 6 drafts the
    // inbox surfaces. fetchInbox doesn't currently use a raw `sql\`\``
    // template that would trip the Date-binding class, but it does have
    // a LEFT JOIN to agents — the assertion is here so any future
    // refactor that introduces the same bug class trips this test.
    const emptyState = page.getByText("No drafts awaiting decision");
    await expect(
      emptyState,
      "inbox empty state visible — fetchInbox hit its catch block",
    ).not.toBeVisible();
    const draftLinks = page.locator('a[href^="/drafts/"]');
    await expect(draftLinks.first()).toBeVisible({ timeout: 5000 });
    const linkCount = await draftLinks.count();
    expect(
      linkCount,
      "inbox row count below seeded floor (4 awaiting + 2 in_review)",
    ).toBeGreaterThanOrEqual(4);
  });
});
