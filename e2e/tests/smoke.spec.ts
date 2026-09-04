import { test, expect } from "@playwright/test";
test("api health", async ({ request }) => {
  const r = await request.get((process.env.API_URL ?? "http://localhost:4000") + "/v1/health");
  expect(r.ok()).toBeTruthy();
});
