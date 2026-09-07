-- A stable, unique, public creator handle on the account (gtm.md 勝ち筋 A ②).
--
-- Worlds were credited to the creator's most recent persona handle. A persona is per (user, world),
-- so the credit moved when its author started a second world, and did not exist at all until they
-- had played one. This migration gives every account a name and hands the credit to it.
--
-- It is written so it cannot fail on data that already exists:
--   * the column arrives nullable, is filled, and only then becomes NOT NULL + UNIQUE;
--   * the backfill from personas is deduplicated *before* the unique index exists, so two accounts
--     that play under the same handle cannot both claim it;
--   * every account the backfill cannot serve is given a generated name by a loop that retries
--     until the name is free, with a guaranteed-terminating fallback;
--   * nothing here reads application code, so it keeps working when that code changes.

-- 1. The columns, nullable for now.
ALTER TABLE "User" ADD COLUMN "creatorHandle" TEXT;
ALTER TABLE "User" ADD COLUMN "creatorHandleClaimedAt" TIMESTAMP(3);

-- 2. Keep today's credit wherever that is possible.
--
--    `creatorHandles()` returned the creator's *most recent* persona handle, so that is the string
--    already printed on their worlds; taking it here means migration day changes no credit that is
--    currently shown. Three reasons a row is skipped, all of them leaving it to step 3:
--      * two accounts whose latest persona goes by the same handle — the earlier persona wins, the
--        other account gets a generated name (a handle is per-world, so this is legitimate data);
--      * the handle belongs to some world's cast, which a creator handle may never be confusable
--        with (services/creator-handle.ts);
--      * the handle is reserved or not of the shape a handle has.
--    `creatorHandleClaimedAt` is stamped for these accounts: they already appear under this name,
--    so the one-time "adopt your first persona's handle" upgrade must not move it later.
WITH latest AS (
  SELECT DISTINCT ON (p."userId")
         p."userId" AS user_id,
         lower(p."handle") AS handle,
         p."createdAt" AS created_at
  FROM "Persona" p
  ORDER BY p."userId", p."createdAt" DESC, p."id" DESC
), usable AS (
  SELECT l.user_id, l.handle, l.created_at
  FROM latest l
  WHERE l.handle ~ '^[a-z0-9_]{3,15}$'
    AND l.handle NOT IN (
      'admin','administrator','support','staff','team','help','root','system',
      'official','moderator','mod','status','rpgllm','me','you','null','undefined'
    )
    AND NOT EXISTS (
      SELECT 1 FROM "WorldCharacter" wc WHERE lower(ltrim(wc."handle", '@')) = l.handle
    )
), winners AS (
  SELECT u.user_id, u.handle
  FROM (
    SELECT user_id, handle,
           row_number() OVER (PARTITION BY handle ORDER BY created_at ASC, user_id ASC) AS rn
    FROM usable
  ) u
  WHERE u.rn = 1
)
UPDATE "User" usr
SET "creatorHandle" = w.handle,
    "creatorHandleClaimedAt" = now()
FROM winners w
WHERE usr."id" = w.user_id;

-- 3. Everybody else gets a readable placeholder — the same `<adjective><noun><NN>` shape the
--    application mints at signup (services/creator-handle.ts holds the source of truth; these two
--    lists are a frozen copy on purpose, so editing that file can never change this migration).
--    `creatorHandleClaimedAt` stays NULL for them: an account that has never had a persona may
--    still name itself with its first one.
DO $$
DECLARE
  adjectives text[] := ARRAY[
    'amber','brave','calm','clever','cosmic','dusty','eager','early',
    'fair','fleet','gentle','giddy','glad','golden','happy','keen',
    'lucky','mellow','merry','mild','noble','plain','quiet','rapid',
    'sharp','silver','snowy','soft','solar','sunny','swift','vivid'];
  nouns text[] := ARRAY[
    'anchor','atlas','beacon','cedar','cinder','comet','coral','delta',
    'ember','falcon','fern','forge','harbor','heron','ivy','kite',
    'lark','lotus','maple','meadow','otter','pebble','quill','raven',
    'reef','river','sable','stone','thorn','tide','vale','wren'];
  row_id    text;
  digest    bytea;
  candidate text;
  salt      int;
BEGIN
  FOR row_id IN SELECT "id" FROM "User" WHERE "creatorHandle" IS NULL ORDER BY "id" LOOP
    salt := 0;
    LOOP
      digest := decode(md5(row_id || ':' || salt::text), 'hex');
      IF salt < 200 THEN
        candidate := adjectives[1 + (get_byte(digest, 0) % array_length(adjectives, 1))]
                  || nouns[1 + (get_byte(digest, 1) % array_length(nouns, 1))]
                  || lpad((get_byte(digest, 2) % 100)::text, 2, '0');
      ELSE
        -- Unreachable with any plausible number of accounts, and there so that this loop has a
        -- proof of termination rather than an argument about probability: every further candidate
        -- is a different string, so one of them is free.
        candidate := 'maker' || substr(md5(row_id || ':' || salt::text), 1, 8);
      END IF;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "User" WHERE "creatorHandle" = candidate)
            AND NOT EXISTS (SELECT 1 FROM "WorldCharacter" wc WHERE lower(ltrim(wc."handle", '@')) = candidate);
      salt := salt + 1;
    END LOOP;
    UPDATE "User" SET "creatorHandle" = candidate WHERE "id" = row_id;
  END LOOP;
END $$;

-- 4. Now the invariants can be the database's: every account has a name, and no two share one.
--    Handles are stored normalised (lowercase, `services/handles.ts`), so this plain unique index
--    is the case-insensitive uniqueness the product needs.
ALTER TABLE "User" ALTER COLUMN "creatorHandle" SET NOT NULL;
CREATE UNIQUE INDEX "User_creatorHandle_key" ON "User"("creatorHandle");
