import { expect, test } from "@playwright/test";
import { T } from "@rpgllm/shared";
import {
  apiUrl, dismissStatCard, enterWorld, firstPostFlow, loginInBrowser, apiSignup, resetDb, unwrap,
} from "../fixtures";

/**
 * S3-5 / S3-6 — the cost dashboard has to be true of a real action, not of seeded rows.
 * One post is driven through the UI, then `/v1/cost/*` is asked what it cost.
 *
 * The cost routes are admin-only; the E2E API runs with `TEST_HOOKS=1`, which opens them
 * (see apps/api/src/routes/cost.ts). No admin token is needed here.
 */

interface CostRow {
  key: string; calls: number; inputTokens: number; cacheWriteTokens: number; cacheReadTokens: number;
  outputTokens: number; costUsd: number; fallbacks: number; p50LatencyMs: number; p95LatencyMs: number;
}
interface CostSummary {
  since: string; until: string; days: number;
  totals: CostRow; byDay: CostRow[]; byGenerator: CostRow[]; byVariant: CostRow[]; byModel: CostRow[];
  perAction: { actions: number; usdPerAction: number; usdPerActiveUser: number };
  cacheHitRate: number;
  ratings: { up: number; down: number; regenerations: number };
  ttft: { p50Ms: number; p95Ms: number; samples: number };
  perDay: { day: string; actions: number; activeUsers: number; usdPerAction: number }[];
  variants: { generator: string; variantId: string; isChampion: boolean; calls: number; allocation: number; usdPerCall: number }[];
  alarms: { cacheHitRateLow: boolean; costPerActionOverChampion: boolean; ttftP95High: boolean };
}
interface CostLive {
  usdPerAction: number; cacheHitRate: number; fallbackRate: number; p95LatencyMs: number;
  alarms: { cacheHitRateLow: boolean; costPerActionOverChampion: boolean; ttftP95High: boolean };
}

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test("S3-5: one post through the UI shows up in the cost dashboard", async ({ page, request }) => {
  const account = await apiSignup(request, { locale: "en" });
  await loginInBrowser(page, account.jwt);
  await enterWorld(page);

  await firstPostFlow(page);
  await dismissStatCard(page);

  const summary = await unwrap<CostSummary>(
    await request.get(apiUrl("/v1/cost/summary?days=1"), { failOnStatusCode: false }),
    "GET /v1/cost/summary",
  );

  // the reaction fan-out (G1) is the call that a post pays for
  const g1 = summary.byGenerator.find((r) => r.key === "G1");
  expect(g1, "the post must have produced at least one G1 row").toBeTruthy();
  expect(g1!.calls, "G1 calls").toBeGreaterThanOrEqual(1);
  expect(g1!.inputTokens + g1!.cacheReadTokens, "G1 must report prompt tokens").toBeGreaterThan(0);
  expect(g1!.outputTokens, "G1 must report output tokens").toBeGreaterThan(0);
  expect(g1!.costUsd, "G1 must be priced").toBeGreaterThan(0);
  expect(g1!.p95LatencyMs, "latency percentiles are recorded").toBeGreaterThanOrEqual(0);

  // the four token counts and the money add up at the top level
  expect(summary.totals.calls).toBeGreaterThanOrEqual(g1!.calls);
  expect(summary.totals.costUsd).toBeGreaterThan(0);
  expect(summary.byGenerator.reduce((s, r) => s + r.calls, 0)).toBe(summary.totals.calls);

  // $/action: at least the one energy-spending action we just performed
  expect(summary.perAction.actions, "posting spends 1 energy = 1 action").toBeGreaterThanOrEqual(1);
  expect(summary.perAction.usdPerAction, "$/action must be a real number > 0").toBeGreaterThan(0);
  expect(summary.perAction.usdPerActiveUser).toBeGreaterThan(0);

  // the breakdowns and the daily series are populated, not stubs
  expect(summary.byVariant.length).toBeGreaterThan(0);
  expect(summary.byModel.length).toBeGreaterThan(0);
  expect(summary.byDay.length).toBeGreaterThan(0);
  expect(summary.perDay.some((d) => d.actions >= 1)).toBe(true);
  expect(summary.variants.some((v) => v.generator === "G1")).toBe(true);
  expect(summary.days).toBe(1);

  const live = await unwrap<CostLive>(
    await request.get(apiUrl("/v1/cost/live"), { failOnStatusCode: false }),
    "GET /v1/cost/live",
  );
  expect(live.usdPerAction).toBeGreaterThan(0);
  expect(live.fallbackRate, "a replay run must not fall back").toBe(0);
  for (const key of ["cacheHitRateLow", "costPerActionOverChampion", "ttftP95High"] as const) {
    expect(typeof live.alarms[key], `${key} must be a boolean the probe can alert on`).toBe("boolean");
  }
});

test("S3-6: the feed's controls carry accessible names", async ({ page, request }) => {
  const account = await apiSignup(request, { locale: "en" });
  await loginInBrowser(page, account.jwt);
  await enterWorld(page);

  // SCR-010: the energy badge reads "Energy <n>", not a bare number
  const badge = page.getByTestId(T.energyBadge);
  await expect(badge).toBeVisible();
  await expect(badge, "energy badge must be a named button").toHaveAttribute("aria-label", /energy/i);
  await expect(badge).toHaveAttribute("aria-label", /\d/);

  // SCR-011: the composer's input and its submit button both have names
  await page.getByTestId(T.composeFab).click();
  await expect(page.getByTestId(T.composeInput)).toBeVisible();
  await expect(page.getByTestId(T.composeInput)).toHaveAttribute("aria-label", /\S/);
  await expect(page.getByTestId(T.composeSubmit)).toHaveAttribute("aria-label", /\S/);
  await expect(page.getByTestId(T.composeCancel)).toHaveAttribute("aria-label", /\S/);
});
