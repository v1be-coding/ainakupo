import { expect, test } from "../helpers/fixtures.js";

// Spec #4 (Test contract inputs › Changes to existing frozen tests) changed all
// three checks for AInakupo.

test("the page loads in a real browser", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "AInakupo" })).toBeVisible();
});

test("the API answers through the page", async ({ page }) => {
  await page.goto("/");

  // Production has no traces until an episode connects, so either state counts.
  await expect(page.getByRole("region", { name: "Totals" }).or(page.getByText("No traces yet"))).toBeVisible();
});

test("a read reaches the database", async ({ request }) => {
  // Production has no keys to write with, so this reads only.
  const response = await request.get("/api/summary");

  expect(response.status()).toBe(200);
  expect(((await response.json()) as { daily: unknown[] }).daily).toHaveLength(14);
});
