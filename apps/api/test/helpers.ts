import type { Hono } from "hono";
import { PrismaClient } from "@prisma/client";
import { DEV_EMAIL_CODE } from "@rpgllm/shared";
import { createApp } from "../src/app";
import { createClock, type Clock } from "../src/clock";
import { createFakeGateway, type FakeGateway } from "../src/fake-gateway";
import { FALLBACK_WORLD_SEEDS } from "../src/seed-fallback";
import { seedDatabase } from "../src/seed";
import { setWorldSeeds } from "../src/services/world-seeds";
import type { AppEnv } from "../src/types";

// Tests pin the stand-in seed so they never depend on Agent B's content landing.
setWorldSeeds(FALLBACK_WORLD_SEEDS);

export const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const TRUNCATE_ALL = [
  "Rating", "ExperimentAssignment", "LedgerEntry", "Purchase", "Subscription", "Wallet",
  "MemoryEntry", "RelationshipState", "StatSnapshot", "Event", "DMMessage", "DMThread",
  "Post", "Persona", "GenerationLog", "User", "AmbientPost", "WorldCharacter", "World",
];

export interface Harness {
  app: Hono<AppEnv>;
  prisma: PrismaClient;
  clock: Clock;
  gateway: FakeGateway;
}

export function makeHarness(): Harness {
  const clock = createClock();
  const gateway = createFakeGateway("replay");
  const app = createApp({ prisma, gateway, clock });
  return { app, prisma, clock, gateway };
}

export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TRUNCATE_ALL.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await seedDatabase(prisma);
}

export interface JsonResponse<T> { status: number; data: T; error: { code: string; message: string } | null }

export async function call<T = unknown>(
  h: Harness,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<JsonResponse<T>> {
  const headers: Record<string, string> = {};
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await h.app.request(path, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as { data: T; error: { code: string; message: string } | null }) : { data: null as T, error: null };
  return { status: res.status, data: parsed.data, error: parsed.error };
}

export interface SSEEvent { event: string; data: Record<string, unknown> }

export async function readSSE(h: Harness, path: string, token: string): Promise<SSEEvent[]> {
  const res = await h.app.request(path, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  return text
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .flatMap((chunk): SSEEvent[] => {
      let event = "message";
      const dataLines: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) return [];
      return [{ event, data: JSON.parse(dataLines.join("\n")) as Record<string, unknown> }];
    });
}

let emailSeq = 0;

export async function signup(
  h: Harness,
  opts: { birthYear?: number; locale?: "en" | "ja"; email?: string } = {},
): Promise<{ token: string; userId: string; ageGateStatus: number }> {
  const email = opts.email ?? `user${++emailSeq}.${Date.now()}@example.com`;
  const auth = await call<{ jwt: string; isNew: boolean; needsAgeGate: boolean }>(h, "POST", "/v1/auth/email/verify", {
    body: { email, code: DEV_EMAIL_CODE },
  });
  const token = auth.data.jwt;
  const gate = await call<{ isMinor: boolean }>(h, "POST", "/v1/auth/age-gate", {
    token,
    body: { birthYear: opts.birthYear ?? 1995, locale: opts.locale ?? "en" },
  });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { token, userId: user.id, ageGateStatus: gate.status };
}

export interface PersonaFixture {
  token: string;
  userId: string;
  personaId: string;
  worldId: string;
  firstFollowerId: string;
  characters: { id: string; handle: string }[];
}

export async function signupWithPersona(
  h: Harness,
  opts: { locale?: "en" | "ja"; birthYear?: number; handle?: string } = {},
): Promise<PersonaFixture> {
  const { token, userId } = await signup(h, { locale: opts.locale, birthYear: opts.birthYear });
  const worlds = await call<{ id: string; slug: string }[]>(h, "GET", "/v1/worlds", { token });
  const world = worlds.data.find((w) => w.slug === "popstar-era") ?? worlds.data[0]!;
  const detail = await call<{ characters: { id: string; handle: string; canBeFirstFollower: boolean }[] }>(
    h, "GET", `/v1/worlds/${world.id}`, { token },
  );
  const firstFollower = detail.data.characters.find((ch) => ch.handle === "@hivequeenbea")
    ?? detail.data.characters.find((ch) => ch.canBeFirstFollower)!;
  const created = await call<{ persona: { id: string }; feedReady: boolean }>(h, "POST", "/v1/personas", {
    token,
    body: {
      worldId: world.id,
      handle: opts.handle ?? `taytay${Math.floor(Math.random() * 100000)}`,
      displayName: "Tay",
      bio: "new era same me",
      avatarUrl: null,
      voiceNotes: "",
      firstFollowerId: firstFollower.id,
      idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`,
    },
  });
  return {
    token,
    userId,
    personaId: created.data.persona.id,
    worldId: world.id,
    firstFollowerId: firstFollower.id,
    characters: detail.data.characters,
  };
}

export const setEnergy = (h: Harness, token: string, energy: number) =>
  call<{ energy: number }>(h, "POST", "/v1/__test/set-energy", { token, body: { energy } });

export const getWallet = (h: Harness, token: string) =>
  call<{ energy: number; coffee: number; adRewardsToday: number; adsEnabled: boolean; dailyMax: number; dailyRefillAt: string }>(
    h, "GET", "/v1/wallet", { token },
  );
