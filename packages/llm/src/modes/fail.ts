import { GeneratorFailure } from "../errors.js";

/**
 * Fail mode (LLM_MODE=fail, or `POST /__test/llm-mode {mode:"fail"}`).
 * Every generator call throws here; the gateway catches it and returns the generator's
 * deterministic fallback with `meta.fallback = true` and `meta.stopReason = "error"`.
 * E2E-010 depends on the app staying usable and the user not being charged.
 */
export function runFail(): never {
  throw new GeneratorFailure("error", "LLM_MODE=fail");
}
