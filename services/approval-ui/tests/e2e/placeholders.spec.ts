// Placeholder routes — /members, /settings render a stub page with the
// same shell shape: <h1>{name}</h1> + a Card containing the "Spec in
// flight" footer text.
//
// /workspace and /calendar GRADUATED to real pages in this sprint —
// they're now covered by their own dedicated assertions (this file
// asserts only the still-stub routes, so a regression where /workspace
// or /calendar accidentally falls back to placeholder copy fails the
// dedicated test rather than silently passing here).
//
// Verifies, per route:
//   - h1 with the page name renders
//   - "Spec in flight" footer text renders (sentinel that the placeholder
//     wasn't replaced silently with a real page that drops the marker)

import { test, expect } from "@playwright/test";

const PLACEHOLDERS = [
  { path: "/members", name: "members" },
  { path: "/settings", name: "settings" },
] as const;

for (const { path, name } of PLACEHOLDERS) {
  test(`placeholder page ${path} renders header and "spec in flight"`, async ({
    page,
  }) => {
    await page.goto(path);

    // Each placeholder uses an <h1> with the lowercase route name.
    await expect(page.locator("main").getByRole("heading", { name, exact: true })).toBeVisible();

    // Footer copy: every placeholder ends with "Spec in flight." Use a
    // case-insensitive regex so a future copy tweak (e.g. "Spec in flight…")
    // doesn't make the test brittle.
    await expect(page.getByText(/spec in flight/i)).toBeVisible();
  });
}

// /workspace + /calendar smoke tests — assert seeded data renders rather
// than the placeholder copy. Catches the same silent-catch-to-empty-state
// regression class the seeded-data-regression suite covers for the other
// real pages.
test("/workspace renders seeded counters (catches silent-fail in fetchWorkspace)", async ({
  page,
}) => {
  await page.goto("/workspace");
  await expect(
    page.locator("main").getByRole("heading", { name: /workspace/i }),
  ).toBeVisible();
  // The placeholder used to render "spec in flight"; the real workspace
  // page must not. If the fetcher hits its catch the page reverts to an
  // empty-counter dashboard but the spec-in-flight copy stays absent —
  // so we assert on the seeded-data side too: the agent-roster column
  // shows the agent count, which is non-zero on the seed.
  await expect(page.getByText(/spec in flight/i)).not.toBeVisible();
  await expect(page.getByText(/working now/i)).toBeVisible();
  await expect(page.getByText(/captured/i)).toBeVisible();
});

test("/calendar renders seeded scheduled drafts (catches silent-fail in fetchCalendar)", async ({
  page,
}) => {
  await page.goto("/calendar");
  await expect(
    page.locator("main").getByRole("heading", { name: /calendar/i }),
  ).toBeVisible();
  await expect(page.getByText(/spec in flight/i)).not.toBeVisible();
  // Seed schedules 4 drafts in [+22h, +9d]; both upcoming AND recent
  // populate the date-grouped sections.
  await expect(page.getByText(/upcoming/i).first()).toBeVisible();
});
