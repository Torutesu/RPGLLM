-- Session revocation.
--
-- A session JWT is valid for 30 days and `verifySession` checked only the signature, so a token
-- that leaked — a lost phone, a shared computer, a copied localStorage — could not be taken back
-- by the user or by us. The client's "Sign out" dropped the local copy and nothing else, which
-- means the button was telling the truth only on the device pressing it.
--
-- One integer fixes that: the token carries the generation it was issued under, `requireAuth`
-- compares, and incrementing this column invalidates every token ever issued for the account.

ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
