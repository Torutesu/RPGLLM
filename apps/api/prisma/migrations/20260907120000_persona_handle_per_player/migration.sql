-- Persona handles are unique to a *player* within a world, not to the world.
--
-- `status` is single-player: a `Persona` is per (user, world), every post is scoped by `personaId`,
-- and two players in the same world never see each other. The old `(worldId, handle)` index made
-- strangers compete for names in a world they do not share, and it got worse the more a world was
-- played — the thousandth player of a popular world was told "@rina is taken" by someone they will
-- never meet. Worse, `GET /v1/worlds/:id` hands every player the *same* `presetPersonas` handles to
-- pick from.
--
-- The new index is strictly weaker than the one it replaces: any set of rows that satisfied
-- (worldId, handle) also satisfies (worldId, userId, handle). So this cannot fail on existing data,
-- and no row is rewritten or lost. `IF EXISTS` / `IF NOT EXISTS` keep it re-runnable against a
-- database that has already been repaired by hand.
--
-- Collisions with a *cast* handle (`WorldCharacter`) are a different constraint — two `@rina` in one
-- feed would make reply targeting ambiguous — and they span two tables, so they are enforced in
-- `apps/api/src/services/persona-handle.ts` rather than by an index.

-- DropIndex
DROP INDEX IF EXISTS "Persona_worldId_handle_key";

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Persona_worldId_userId_handle_key" ON "Persona"("worldId", "userId", "handle");
