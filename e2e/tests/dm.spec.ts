import { expect, test } from "@playwright/test";
import { T } from "@rpgllm/shared";
import {
  apiSignup, dmThread, dmThreads, enterWorld, expectWalletEnergy, FIRST_FOLLOWER, loginInBrowser,
  me, resetDb, wallet,
} from "../fixtures";

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test("E2E-006: sending a DM gets an answer from the character", async ({ page, request }) => {
  const account = await apiSignup(request, { locale: "en" });
  await loginInBrowser(page, account.jwt);
  await enterWorld(page);

  const energyBefore = (await wallet(request, account.jwt)).energy;

  // SCR-020: DMs → New message → @hivequeenbea
  await page.getByTestId(T.tabDms).click();
  await page.getByTestId(T.dmNew).click();
  const target = page.getByTestId(T.dmChar(FIRST_FOLLOWER));
  await expect(target, `@${FIRST_FOLLOWER} must be listed as a follower to message`).toBeVisible({ timeout: 15_000 });
  await target.click();

  // SCR-021
  const input = page.getByTestId(T.dmInput);
  await expect(input, "SCR-021 composer").toBeVisible({ timeout: 15_000 });
  const affinityBefore = ((await page.getByTestId(T.dmAffinity).textContent()) ?? "").trim();

  const bubbles = page.getByTestId(T.dmBubble);
  const bubblesBefore = await bubbles.count();

  await input.fill("did you see gmz?");
  await page.getByTestId(T.dmSend).click();

  // typing indicator, then 1–3 reply bubbles
  await expect(page.getByTestId(T.dmTyping), "a typing indicator must show while the answer streams")
    .toBeVisible({ timeout: 5_000 });

  await expect
    .poll(() => bubbles.count(), { timeout: 20_000, message: "the character must answer" })
    .toBeGreaterThanOrEqual(bubblesBefore + 2); // 1 outgoing + ≥1 incoming

  await expect(page.getByTestId(T.dmTyping)).toBeHidden({ timeout: 20_000 });
  const after = await bubbles.count();
  expect(after - bubblesBefore - 1, "the character answers with 1–3 bubbles").toBeGreaterThanOrEqual(1);
  expect(after - bubblesBefore - 1, "the character answers with 1–3 bubbles").toBeLessThanOrEqual(3);

  // affinity hearts update
  await expect
    .poll(async () => ((await page.getByTestId(T.dmAffinity).textContent()) ?? "").trim(), {
      timeout: 15_000,
      message: "the affinity hearts must update after the exchange",
    })
    .not.toBe(affinityBefore);

  // one energy per DM
  await expectWalletEnergy(request, account.jwt, energyBefore - 1);

  // and the exchange is durable server-side
  const persona = (await me(request, account.jwt)).persona;
  if (!persona) throw new Error("a persona must exist after onboarding");
  const { threads } = await dmThreads(request, account.jwt, persona.id);
  const thread = threads.find((t) => t.character.handle.replace(/^@/, "") === FIRST_FOLLOWER);
  if (!thread) throw new Error(`no DM thread with @${FIRST_FOLLOWER}`);
  const detail = await dmThread(request, account.jwt, thread.id);
  expect(detail.messages.filter((m) => m.fromCharacter).length, "stored character replies")
    .toBeGreaterThanOrEqual(1);
});

/* --------------------------------------------------------------- P1 ------- */

// E2E-018: Given a post about getting a cat + the memory consolidation job / When asking
// "how have you been?" in a DM / Then the answer references the cat (judge-scored).
test.skip("E2E-018 (P1): characters remember earlier posts", () => {});
