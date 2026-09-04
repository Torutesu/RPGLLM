/**
 * `bandit-update` — the §6.3 loop, hourly.
 *
 * `refreshBandit` (Agent N, `services/bandit.ts`) is the whole job in one call: fold the new
 * `GenerationLog`/`Rating` rows into the Beta posteriors, check the guardrails, then try to promote
 * a challenger that has cleared both the posterior test and the §6.2 offline gate. The allocator
 * the API serves traffic from reads a cached snapshot of the arms, so the last step is refreshing
 * that snapshot — **in this process**. A worker refresh does not reach the API's memory: each API
 * instance warms its own snapshot at boot (`index.ts`) and picks the new arms up on the next
 * restart or the next time it runs this job itself; the arms move slowly (500 calls minimum before
 * a promotion), so an hour of staleness costs nothing.
 */
import { logLine } from "../middleware/request-log";
import { refreshAllocatorSnapshot, refreshBandit } from "../services/bandit";
import type { JobDeps, JobOutcome } from "./registry";

export async function runBanditUpdate(deps: JobDeps): Promise<JobOutcome> {
  const now = deps.clock.now();
  const { update, guardrails, promotions } = await refreshBandit(deps.prisma, now);
  const promoted = promotions.filter((p) => p.promoted).length;
  const arms = await refreshAllocatorSnapshot(deps.prisma, now);
  logLine({
    level: "info", msg: "job.bandit", calls: update.calls, armsFolded: update.arms,
    generators: update.generators.length, disabled: guardrails.disabled.length, promoted, arms,
  });
  return {
    processed: update.calls,
    detail: {
      calls: update.calls, armsFolded: update.arms, generators: update.generators.length,
      disabled: guardrails.disabled.length, promoted, arms,
    },
  };
}
