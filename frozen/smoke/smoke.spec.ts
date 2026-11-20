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

// The edge maps only S3's 403 to the 404 page, so a missing page gets the HTML
// page and the API's own JSON 404 reaches the client (v1be-infra #61). Branch
// edges map it the same way, so both run on branch and production.
test("an unknown page returns the HTML 404 page", async ({ request }) => {
  const response = await request.get(`/no-such-page-${crypto.randomUUID()}`);

  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toMatch(/^text\/html/);
});

test("an unknown API path returns the API's JSON 404", async ({ request }) => {
  const response = await request.get(`/api/no-such-path-${crypto.randomUUID()}`);

  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(await response.json()).toEqual({ error: "Not found" });
});
