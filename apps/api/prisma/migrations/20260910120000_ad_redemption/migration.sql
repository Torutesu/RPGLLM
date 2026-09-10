-- One AdMob reward callback may be redeemed once.
--
-- `verifyAdMobSSV` checked the signature, the timestamp and the user id, and then returned the
-- `transaction_id` to a caller that dropped it. A signature is not a nonce: anybody who captured
-- one valid callback — their own, from their own device — could POST it again every few seconds
-- and mint energy until the daily cap, then again tomorrow, forever. This table is the nonce.
--
-- The row is written in the same transaction as the grant, so there is no window where energy
-- exists and the redemption does not.

CREATE TABLE "AdRedemption" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdRedemption_pkey" PRIMARY KEY ("id")
);

-- The whole point: the database refuses the second grant, whatever the application forgets.
CREATE UNIQUE INDEX "AdRedemption_transactionId_key" ON "AdRedemption"("transactionId");

CREATE INDEX "AdRedemption_userId_createdAt_idx" ON "AdRedemption"("userId", "createdAt");

ALTER TABLE "AdRedemption" ADD CONSTRAINT "AdRedemption_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
