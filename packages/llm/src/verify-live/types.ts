import type { GenerationMeta, Locale, Usage, WorldGenre } from "@rpgllm/shared";
import type { EvalRunResult } from "../eval-core.js";
import type { G9Distinctness } from "../eval-g9.js";
import type { BilingualRow, CastDistinctness, LiveEvidence, StageSpend } from "./measure.js";

/** `live` is the real thing; `stub` is the rehearsal, and every surface says which it was. */
export type VerifyMode = "live" | "stub";

export type AnswerVerdict = "pass" | "fail" | "human" | "unknown";

export interface Answer {
  id: "ja-native" | "distinct-worlds" | "distinct-cast";
  question: string;
  verdict: AnswerVerdict;
  /** one line, the number that decides it */
  headline: string;
  detail: string[];
  /** what this run cannot settle, stated rather than implied */
  limits: string[];
}

export interface SpendReport {
  stages: StageSpend[];
  usage: Usage;
  totalUsd: number;
  generatorUsd: number;
  judgeUsd: number;
  worlds: number;
  usdPerWorld: number;
  cacheHitRate: number;
  /** what the replay-token estimator said before the run, for the same plan */
  estimateUsd: number | null;
  estimatePerWorldUsd: number | null;
}

export interface GenrePairRow {
  genre: WorldGenre;
  aKey: string;
  bKey: string;
  live: G9Distinctness | null;
  blueprint: G9Distinctness | null;
}

export interface DistinctnessReport {
  pairs: GenrePairRow[];
  meanBibleLineOverlapLive: number | null;
  meanBibleLineOverlapBlueprint: number | null;
  meanCastCardOverlapLive: number | null;
  meanCastCardOverlapBlueprint: number | null;
  /** the floor: two worlds of *different* genres, same run */
  crossGenreLive: number | null;
  crossGenreBlueprint: number | null;
  failing: string[];
}

export interface CastRow {
  key: string;
  locale: Locale;
  live: CastDistinctness | null;
  blueprint: CastDistinctness | null;
}

export interface JapaneseRow {
  key: string;
  label: string;
  jaCjkRatio: number;
  jaEchoesEn: number;
  jaRoleCjkRatio: number;
  castRolesLocalized: number;
  castSize: number;
  bibleTokensJa: number;
  bibleTokensEn: number;
}

export interface BilingualPanel {
  key: string;
  label: string;
  titleEn: string;
  titleJa: string;
  rows: BilingualRow[];
}

export interface JapaneseReport {
  rows: JapaneseRow[];
  panels: BilingualPanel[];
  checklist: readonly string[];
}

export interface FailureRow {
  key: string;
  stage: string;
  kind: string;
  detail: string;
}

export interface VerifyReport {
  mode: VerifyMode;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  plan: { genres: WorldGenre[]; worlds: number; generatorCalls: number; judgeCalls: number };
  variantId: string;
  evidence: LiveEvidence;
  judgeSource: "live" | "replay heuristic" | "mixed" | "absent";
  gate: EvalRunResult;
  spend: SpendReport;
  distinctness: DistinctnessReport;
  cast: CastRow[];
  japanese: JapaneseReport;
  failures: FailureRow[];
  answers: Answer[];
  /** worlds that never came back — a timeout or a total failure, kept as a result */
  missing: string[];
  notes: string[];
  metas: GenerationMeta[];
}
