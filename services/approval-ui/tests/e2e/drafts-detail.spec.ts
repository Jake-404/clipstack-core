// /drafts/[draftId] — the detail page for a single draft. We navigate to
// it via the inbox to capture a deterministic URL rather than constructing
// the seed's namespaced UUID by hand. The 4 awaiting_approval drafts in
// the seed each have an `approvalId`, so each surfaces the
// ApprovalActions component (approve + deny buttons).
//
// Verifies:
//   - approve + deny buttons are visible on a pending draft
//   - clicking deny reveals the inline form (textarea + 3 scope radios)
//   - typing 25 chars in the textarea enables the "deny + capture lesson"
//     submit button
//
// IMPORTANT: this test does not click the submit button — submitting
// would mutate seeded data and make subsequent test runs non-deterministic
// (the draft would move to status=denied and a lesson would be inserted).

import { test, expect } from "@playwright/test";

test("draft detail shows approval actions and deny form gates on rationale", async ({
  page,
}) => {
  // Arrive via /inbox so we click into a real pending draft. Picking the
  // first row gives us a deterministic target — the inbox sorts oldest-
  // first and the seed's deterministic UUIDs guarantee the first row is
  // always the same draft across runs.
  await page.goto("/inbox");
  const draftLinks = page.locator('a[href^="/drafts/"]');
  await draftLinks.first().waitFor({ state: "visible" });
  await draftLinks.first().click();
  await expect(page).toHaveURL(/\/drafts\/[0-9a-fA-F-]{36}$/);

  // Approve + deny buttons render inside the ApprovalActions component
  // when the draft is awaiting human action AND has an approvalId. The
  // seed's first awaiting_approval draft satisfies both, so both buttons
  // must be visible immediately.
  const approveBtn = page.getByRole("button", { name: "approve", exact: true });
  const denyBtn = page.getByRole("button", { name: "deny", exact: true });
  await expect(approveBtn).toBeVisible();
  await expect(denyBtn).toBeVisible();

  // Click deny → the component swaps to the inline form with a textarea
  // and a fieldset of 3 scope radios.
  await denyBtn.click();

  // Textarea: ApprovalActions renders one textarea with placeholder
  // copy. Wait for it to mount before asserting.
  const textarea = page.locator("textarea");
  await textarea.waitFor({ state: "visible" });
  await expect(textarea).toBeVisible();

  // 3 scope radios — name="scope", values forever / this_topic / this_client.
  const scopeRadios = page.locator('input[type="radio"][name="scope"]');
  await expect(scopeRadios).toHaveCount(3);

  // The submit button "deny + capture lesson" exists immediately but is
  // disabled while rationale.trim().length < 20. Verify it's disabled
  // before typing.
  const submitBtn = page.getByRole("button", { name: /deny \+ capture lesson/i });
  await expect(submitBtn).toBeVisible();
  await expect(submitBtn).toBeDisabled();

  // Type 25 chars — comfortably above the 20-char minLength gate.
  await textarea.fill("This is a test rationale.");

  // Now the submit button should be enabled. The form's `disabled` is
  // driven by `isPending || mode.rationale.trim().length < 20`; at 25
  // chars and not-pending, it's enabled.
  await expect(submitBtn).toBeEnabled();

  // INTENTIONALLY do not click submit — submitting would mutate the
  // seeded draft (status → denied) + insert a company_lessons row,
  // breaking determinism for any subsequent test run.
});
