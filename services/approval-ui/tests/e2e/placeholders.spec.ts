// Placeholder routes — /workspace, /calendar, /members, /settings each
// render a stub page with the same shell shape: <h1>{name}</h1> + a Card
// containing the "Spec in flight" footer text.
//
// Verifies, per route:
//   - h1 with the page name renders
//   - "Spec in flight" footer text renders (sentinel that the placeholder
//     wasn't replaced silently with a real page that drops the marker)

import { test, expect } from "@playwright/test";

const PLACEHOLDERS = [
  { path: "/workspace", name: "workspace" },
  { path: "/calendar", name: "calendar" },
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
