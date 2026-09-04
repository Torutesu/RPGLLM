import type { PrismaClient, Prisma, User } from "@prisma/client";
import type { Gateway } from "@rpgllm/llm";
import type { EmailCodeRecord } from "./auth-codes";
import type { Clock } from "./clock";

export interface Deps {
  prisma: PrismaClient;
  gateway: Gateway;
  clock: Clock;
}

/** Per-app mutable state that has no column in the schema (documented in build-notes). */
export interface AppState {
  /** postId -> G8 said "soften"; consumed by the post stream when it calls G1 */
  softenedPosts: Map<string, boolean>;
  /** threadId -> G8 said "soften" for the latest user message */
  softenedThreads: Map<string, boolean>;
  /** idempotencyKey -> personaId (POST /personas) */
  personaIdempotency: Map<string, string>;
  /** email -> pending one-time login code hash (Agent F). TODO(P1): move to Redis/DB. */
  emailCodes: Map<string, EmailCodeRecord>;
}

export type Tx = Prisma.TransactionClient;

export type AppEnv = {
  Variables: {
    userId: string;
    user: User;
    deps: Deps;
    state: AppState;
    /** per-request correlation id (middleware/request-log.ts) */
    requestId: string;
  };
};
