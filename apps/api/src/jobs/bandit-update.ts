/**
 * `bandit-update` — refresh the Thompson-sampling posteriors from `GenerationLog` and check the
 * §6.3 guardrails.
 *
 * The implementation lives in `services/bandit.ts`, which is landing in parallel (Agent N). The
 * import is therefore **lazy and optional**: if the module (or either export) is not there yet, the
 * job logs a warning and reports zero work instead of failing the scheduler tick. Nothing else in
 * the worker knows about the difference, so the job starts doing real work the moment that file
 * lands — no change here.
 */
import { logLine } from "../middleware/request-log";
import { shortError } from "./runs";
import type { JobDeps, JobOutcome } from "./registry";

interface BanditModule {
  updateFromLogs?: (prisma: JobDeps["prisma"], now: Date) => Promise<unknown>;
  checkGuardrails?: (prisma: JobDeps["prisma"], now: Date) => Promise<unknown>;
}

/** Dynamic specifier (not a literal) so this compiles and runs before `services/bandit.ts` exists. */
const BANDIT_MODULE = "../services/bandit";

/** Whatever shape it returns — a count, `{arms}`/`{disabled}`, or nothing — becomes one number. */
const countOf = (value: unknown, key: "arms" | "disabled"): number => {
  if (typeof value === "number") return value;
  if (value !== null && typeof value === "object") {
    const n = (value as Record<string, unknown>)[key];
    if (typeof n === "number") return n;
  }
  return 0;
};

export async function runBanditUpdate(deps: JobDeps): Promise<JobOutcome> {
  let mod: BanditModule;
  try {
    mod = (await import(BANDIT_MODULE)) as BanditModule;
  } catch (err: unknown) {
    logLine({ level: "warn", msg: "job.bandit.unavailable", reason: shortError(err) });
    return { processed: 0, detail: { arms: 0, disabled: 0, available: 0 } };
  }
  if (typeof mod.updateFromLogs !== "function" && typeof mod.checkGuardrails !== "function") {
    logLine({ level: "warn", msg: "job.bandit.unavailable", reason: "no updateFromLogs/checkGuardrails export" });
    return { processed: 0, detail: { arms: 0, disabled: 0, available: 0 } };
  }

  const now = deps.clock.now();
  const arms = typeof mod.updateFromLogs === "function" ? countOf(await mod.updateFromLogs(deps.prisma, now), "arms") : 0;
  const disabled = typeof mod.checkGuardrails === "function" ? countOf(await mod.checkGuardrails(deps.prisma, now), "disabled") : 0;
  return { processed: arms, detail: { arms, disabled, available: 1 } };
}
