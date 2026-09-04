# RPGLLM — Status clone (Expo + Hono + Prisma + Claude)

Spec is the source of truth: `pipeline/status/spec/` (PRD, screens SCR-xxx, schema, API, E2E, AI features AIF-xxx).
Build plan and ownership: `pipeline/status/build-plan.md`. Record any deviation in `pipeline/status/build-notes.md` (append-only).

## Layout
- `packages/shared` — zod contracts for API + generator outputs, constants, design tokens, i18n, data-testids. Additive changes only.
- `packages/llm` — the only place that calls an LLM. `LLM_MODE=replay|live|fail`. Live uses `@anthropic-ai/sdk`.
- `apps/api` — Hono + Prisma 6 (Postgres). Port 4000. `TEST_HOOKS=1` enables `/__test/*`.
- `apps/mobile` — Expo 57 + Expo Router, iOS/Android/Web. Web export served on 8082 for E2E.
- `e2e` — Playwright (Chromium preinstalled at `/opt/pw-browsers`; never run `playwright install`).

## Commands
- DB: `scripts/db.sh start|stop|reset` (Postgres 16 at 127.0.0.1:5432, user `postgres`, DBs `rpgllm`, `rpgllm_test`)
- API: `pnpm --filter api dev` / `test` / `prisma:migrate`
- Client: `pnpm --filter mobile typecheck` / `export:web` / `serve:web`
- LLM: `pnpm --filter llm test`
- E2E: `pnpm e2e` (starts api + web via Playwright webServer)

## Rules
1. Edit only your owned directory (see build-plan §4). Ask for cross-cutting changes in build-notes.
2. Add dependencies with `pnpm --filter <pkg> add <dep>`; never run root `pnpm install` while others work.
3. Never weaken, skip, or delete E2E cases to pass. Fix the code.
4. Colors/fonts/copy only via `packages/shared` tokens and i18n. Every interactive element gets a `data-testid` from `testids.ts`.
5. LLM calls only through `packages/llm` gateway; every call is logged to `GenerationLog` with 4 token counts and cost.
6. Energy: every action = 1 energy in the same DB transaction; refund on `fallback`. 402 when empty; 422 on safety block.
7. Models: `claude-opus-5` (high), `claude-sonnet-5` (mid, thinking disabled for generation), `claude-haiku-4-5` (light). IDs come from env `LLM_MODEL_*`, never hardcoded in call sites.
8. TypeScript strict. No `any` in contracts. Prefer small files.
9. Commits are made by the orchestrator only.
