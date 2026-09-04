/** Internal failure kinds. They map 1:1 to `GenerationMeta.stopReason` on the fallback path. */
export type FailureKind = "error" | "refusal" | "invalid_json";

export class GeneratorFailure extends Error {
  readonly kind: FailureKind;
  constructor(kind: FailureKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GeneratorFailure";
    this.kind = kind;
  }
}

export function failureKindOf(err: unknown): FailureKind {
  return err instanceof GeneratorFailure ? err.kind : "error";
}
