-- Rate-limit buckets, shared across API processes (`RATE_LIMIT_STORE=shared`).
--
-- The in-process limiter is correct for exactly one instance. Behind N replicas the effective
-- budget is N times the intended one, and the budget that matters is five auth attempts a minute:
-- scaling the API out was quietly a security change. Postgres is already a dependency, so a
-- distributed limiter needs no new infrastructure.
--
-- `tokens` is a float because the bucket refills continuously, and it is allowed to reach -1 so a
-- denial leaves a mark (a flood that costs nothing refills as though it never happened).

CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "tokens" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- The sweep in `purge-login-codes` reads this: a bucket at capacity carries no information.
CREATE INDEX "RateLimitBucket_updatedAt_idx" ON "RateLimitBucket"("updatedAt");
