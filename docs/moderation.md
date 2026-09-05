# Moderation — reviewing player-made worlds

Everything in this document is work a **person** does. The code holds the line automatically at two
points (a premise is screened before a gem is spent, a generated world is screened before anyone
else can see it) and takes a reported world off the shelf on its own — but a world only reaches
Explore because a human said yes, and that human needs to know what they are saying yes to.

Code: `packages/llm/src/generators/g9/screen.ts`, `apps/api/src/routes/admin-worlds.ts`,
`apps/api/src/services/{world-studio,moderation}.ts`. Thresholds:
`packages/shared/src/constants.ts` → `WORLD_MODERATION`.

---

## 1. What the machine already decided before you see it

By the time a world is in your queue it has passed three gates. Knowing which is which stops you
re-doing work and stops you trusting work that was never done.

| Gate | When | What it can catch | What it cannot |
|---|---|---|---|
| `screenPremise` | before generation, before any charge | the premise as written: real people and brands, sexualised minors, hate, self-harm, graphic violence, instructions for contraband, prompt injection | anything the *generator* invented that the premise did not say |
| G8 over the generated text | on the request to publish | the bible and cast as generated | anything that only shows up once a player interacts with the world |
| distinct-reporter threshold | after it is live | what players object to in practice | anything nobody reports |

The first two are deterministic vocabulary plus (in live) a model. **Neither is a judgement about
whether the world is a good idea.** That is the part you are for.

## 2. The queue

`GET /v1/admin/worlds/review`. It is ordered so the worst thing is first: worlds pulled back off
the shelf by reports before worlds nobody has looked at yet, oldest before newest. Each row gives
you the premise, an excerpt of the generated bible, the cast, the safety verdict and note, how long
it has waited, and — for a pulled world — the complaints themselves.

**Read the complaints before the world.** A world that reads fine and drew three reports is telling
you something the text is not.

### Service level

`WORLD_MODERATION.REVIEW_SLA_HOURS` (24h). A world past it is flagged `overdue` and counted in
`overdueCount`. The number that matters is not the average, it is the count over the line: a
creator who waited two days has already decided what they think of us.

If `overdueCount` is climbing across a day, that is a staffing signal, not a backlog to sprint at.

## 3. What to approve

A world goes to Explore if **all** of these hold. When one is a near miss, reject with a reason
that says which — the creator can fix a specific thing and cannot fix "no".

1. **Original.** No real people, no real brands, no serial numbers filed off an existing franchise.
   A world that is recognisably someone else's IP with the names changed is a reject, and this is
   the one where the automated screen is weakest, because a paraphrase defeats vocabulary matching.
2. **13+.** Not "no sex scenes" — no world whose *premise* is sexual, no world built around minors
   in a sexual or romantic-with-an-adult frame, no self-harm as a subject to participate in. The
   product is rated 13+ globally; assume a 13-year-old is playing it, because one is.
3. **Playable, not just written.** Eight distinguishable characters, something for a player to
   want. A beautiful bible with eight interchangeable voices is a bad world, and it will read as a
   broken app rather than as a bad world.
4. **Both locales are real.** The JA is written in Japanese, not translated at it. If the JA cast
   cards are visibly machine-flattened English, reject — a Japanese player would be playing a
   worse game than an English one, on the same shelf.
5. **Not a vector.** The premise is not trying to instruct the model, and the generated bible does
   not contain instructions aimed at anything other than the characters.

## 4. What to reject, and how

`POST /v1/admin/worlds/:id/review` with `decision: "reject"` and a `reason`. **The reason is shown
to the creator**, so write it to them, not to us: name the rule and the fix.

A rejected world is not deleted and not confiscated — its creator keeps playing it in private, and
can resubmit after `WORLD_MODERATION.RESUBMIT_COOLDOWN_HOURS` (24h). The cooldown exists so a
rejected world cannot be bounced off the queue continuously; it is not a punishment and should not
be described as one.

Reject rather than approve when you are unsure. An approved world is on a shelf in front of every
player, including the 13-year-old; a rejected one is still playable by the person who made it. The
asymmetry is deliberate and the cost of a wrong reject is one message and a day.

## 5. When a live world is pulled

`WORLD_MODERATION.REPORTS_TO_PULL` distinct reporters take a public world out of Explore and put it
back in your queue automatically, marked `pulled`. Nobody has judged it — the reports are a signal,
not a verdict, and brigading is the obvious attack on a threshold this low.

So: read the complaints, then read the world, then decide. Three people objecting to a world that
is fine is a thing that happens, and re-approving it is the correct outcome. Reviewing a world
resolves the reports that were about it either way — otherwise the queue never empties.

A pulled world stays playable for its creator and for anyone already in it. Pulling is not deleting
and must never be described to a player as a deletion.

## 6. Escalation

| Situation | What to do |
|---|---|
| CSAM or anything that looks like it | Stop. Preserve the row, do not delete it, escalate to the on-call lead immediately. Legal reporting obligations attach and are not the reviewer's call. |
| Credible threat against a real person | Escalate the same way. |
| The same account submitting variations of a rejected world | Reject and flag the account; the cooldown is per world, not per person. |
| A world that passes every rule and still feels wrong | Escalate rather than inventing a rule. If it becomes a rule, it goes in §3 of this document. |
| The automated screen let something obvious through | File it with the premise text. The screen is deterministic vocabulary plus a model; the misses are how it gets fixed, and two of its holes were found exactly this way. |

## 7. Appeals

There is no appeal endpoint yet — a creator's only recourse is to fix the world and resubmit. This
is a known gap: a reject with a bad reason currently has no path back other than the cooldown.
Before this feature carries real volume, decide who reads appeals and how a creator asks for one.

## 8. What this document does not cover

- **Post- and DM-level reports** (`GET /v1/moderation/reports`) — the older surface, separate queue.
- **Who the reviewers are.** No rota, no training set, no second-reader rule for borderline calls.
  A queue with an SLA and nobody rostered against it is a number that goes up.
- **Volume.** Every threshold here was chosen for a product with no users yet. Re-derive
  `REPORTS_TO_PULL` from real report rates before launch: three distinct reporters is deliberately
  jumpy, and it is the right setting only while a false pull costs one reviewer five minutes.
