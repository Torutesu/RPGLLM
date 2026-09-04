/**
 * Minimal in-memory implementation of spec/03-api.md, for manual/E2E smoke checks of the
 * client only. The real API is apps/api (Agent A). Run: node scripts/mock-api.mjs
 */
import http from "node:http";

const port = Number(process.env.PORT ?? 4000);
const now = () => new Date().toISOString();
const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

const CHARACTERS = [
  { id: "c_hive", handle: "hivequeenbea", displayName: "Bea", role: "bestie", avatarUrl: null, isPressAccount: false, canBeFirstFollower: true, intro: "Your loudest defender." },
  { id: "c_drey", handle: "the6ixdrey", displayName: "Drey", role: "rival", avatarUrl: null, isPressAccount: false, canBeFirstFollower: true, intro: "Never lets a beat go." },
  { id: "c_gmz", handle: "gmz", displayName: "GMZ", role: "press", avatarUrl: null, isPressAccount: true, canBeFirstFollower: false, intro: "Sources say…" },
];
const PRESETS = [
  { handle: "taytay19", displayName: "Tay", bio: "songs about you", avatarUrl: null },
  { handle: "kingkay", displayName: "Kay", bio: "the crown fits", avatarUrl: null },
];
const WORLD = { id: "w_pop", slug: "popstar-era", title: "Popstar Era", scenario: "One song from everything changing.", difficulty: 2, coverUrl: null };

const db = {
  user: { id: "u_1", locale: "en", isMinor: false, birthYear: null },
  wallet: { energy: 10, coffee: 2, gems: 0, dailyRefillAt: new Date(Date.now() + 6 * 3600e3).toISOString(), adRewardsToday: 0, adsEnabled: true, adPersonalized: false, dailyMax: 10 },
  subscription: null,
  persona: null,
  posts: [],
  actionCount: 0,
  pendingEvent: null,
  lastSnapshot: null,
  threads: [],
  messages: {},
  affinity: 40,
  streams: {},
};

const mkPost = (kind, handle, text, opts = {}) => ({
  id: uid("p"), kind, text, parentId: opts.parentId ?? null,
  author: { handle, displayName: handle, avatarUrl: null, verified: kind === "character" || kind === "news", isYou: kind === "user" },
  metrics: { likes: 120, reposts: 18, replies: 4 },
  generationId: kind === "user" ? null : uid("g"), createdAt: now(), replies: [],
});

const snapshot = (cause) => ({
  id: uid("s"), cause, narrative: "By morning the timeline had picked a side.",
  followersDelta: 12, auraDelta: 5, humorDelta: 1, relDeltas: { hivequeenbea: 1, the6ixdrey: -1 },
  after: { followers: (db.persona?.followers ?? 120) + 12, aura: 25, humor: 21 }, createdAt: now(),
});

const mkEvent = () => ({
  id: uid("e"), title: "Fabricated screenshots", prompt: "Anonymous sources are flooding the timeline. How do you respond?",
  choices: [
    { id: "burn", label: "Burn it down: drop a diss track at midnight" },
    { id: "receipts", label: "Drop receipts: post the studio voice memos" },
    { id: "silent", label: "Stay silent: let the work speak" },
  ],
  chosenId: null,
});

const send = (res, status, data, error = null) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify({ data, error }));
};
const fail = (res, status, code, message) => send(res, status, null, { code, message });

const body = (req) => new Promise((resolve) => {
  let b = "";
  req.on("data", (c) => { b += c; });
  req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
});

function sse(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
  return (event, payload) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...payload })}\n\n`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname.replace(/^\/v1/, "");
  const m = req.method ?? "GET";
  if (m === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*",
    });
    return res.end();
  }
  const b = m === "POST" ? await body(req) : {};

  if (p === "/health") return send(res, 200, { ok: true, llmMode: "replay", champion: {} });
  if (p === "/auth/email/start") return send(res, 200, {});
  if (p === "/auth/email") return send(res, 200, { jwt: "mock.jwt.token", isNew: true, needsAgeGate: db.user.birthYear === null });
  if (p === "/auth/age-gate") {
    const age = new Date().getFullYear() - Number(b.birthYear ?? 0);
    if (age < 13) return fail(res, 403, "UNDER_13", "too young");
    db.user.birthYear = Number(b.birthYear);
    db.user.isMinor = age < 18;
    db.user.locale = b.locale ?? "en";
    db.wallet.adPersonalized = !db.user.isMinor;
    return send(res, 200, { isMinor: db.user.isMinor });
  }
  if (p === "/me") return send(res, 200, { user: db.user, wallet: db.wallet, subscription: db.subscription, persona: db.persona });
  if (p === "/worlds") return send(res, 200, [WORLD]);
  if (p.startsWith("/worlds/")) return send(res, 200, { world: WORLD, characters: CHARACTERS, presetPersonas: PRESETS });
  if (p === "/personas/check") return send(res, 200, { available: true });
  if (p === "/personas") {
    db.persona = {
      id: "pe_1", worldId: WORLD.id, worldSlug: WORLD.slug, handle: b.handle, displayName: b.displayName, bio: b.bio ?? "",
      avatarUrl: null, followers: 120, aura: 20, humor: 20, level: 1, xp: 0, actionCount: 0,
    };
    const welcome = mkPost("character", "hivequeenbea", "you're finally here. the timeline is not ready.");
    db.posts = [welcome, ...Array.from({ length: 5 }, (_, i) => mkPost("ambient", "the6ixdrey", `the room is always colder at ${i + 1}am`))];
    return send(res, 200, { persona: db.persona, feedReady: true });
  }
  if (p === "/feed") {
    return send(res, 200, { posts: db.posts, nextCursor: null, pendingEvent: db.pendingEvent, lastSnapshot: db.lastSnapshot });
  }
  if (p === "/posts" && m === "POST") {
    const text = String(b.text ?? "");
    if (/12 year old|genitals|graphic sexual/i.test(text)) return fail(res, 422, "SAFETY_BLOCKED", "blocked");
    if (db.wallet.energy < 1) return fail(res, 402, "ENERGY_REQUIRED", "no energy");
    db.wallet.energy -= 1;
    db.actionCount += 1;
    const post = mkPost("user", db.persona?.handle ?? "you", text, { parentId: b.parentId ?? null });
    db.posts = [post, ...db.posts];
    return send(res, 200, { post, streamUrl: `/v1/posts/${post.id}/stream` });
  }
  const streamMatch = p.match(/^\/posts\/([^/]+)\/stream$/);
  if (streamMatch) {
    const write = sse(res);
    const rootId = streamMatch[1];
    setTimeout(() => write("reply", { post: mkPost("character", "hivequeenbea", "iconic timing 👑", { parentId: rootId }) }), 200);
    setTimeout(() => write("reply", { post: mkPost("character", "the6ixdrey", "the song better not be about me", { parentId: rootId }) }), 500);
    setTimeout(() => write("stat", { snapshot: (db.lastSnapshot = snapshot("post")) }), 700);
    if (db.actionCount % 8 === 0) setTimeout(() => write("event", { event: (db.pendingEvent = mkEvent()) }), 800);
    setTimeout(() => { write("done", { energy: db.wallet.energy }); res.end(); }, 1000);
    return;
  }
  const postMatch = p.match(/^\/posts\/([^/]+)$/);
  if (postMatch && m === "GET") {
    const post = db.posts.find((x) => x.id === postMatch[1]) ?? db.posts[0];
    const replies = db.posts.filter((x) => x.parentId === post.id);
    return send(res, 200, { post, replies, moreAvailable: true });
  }
  if (p.endsWith("/more-replies")) {
    return send(res, 200, { replies: [mkPost("character", "kingkay", "late but loud"), mkPost("character", "gmz", "sources say…")] });
  }
  if (p === "/events/pending") return send(res, 200, { event: db.pendingEvent });
  if (p.match(/^\/events\/[^/]+\/choose$/)) {
    if (db.wallet.energy < 1) return fail(res, 402, "ENERGY_REQUIRED", "no energy");
    db.wallet.energy -= 1;
    db.pendingEvent = null;
    const news = mkPost("news", "gmz", "SHOCKER: receipts posted at 2am");
    db.posts = [news, ...db.posts];
    db.lastSnapshot = snapshot("event");
    return send(res, 200, { snapshot: db.lastSnapshot, newsPost: news, energy: db.wallet.energy });
  }
  if (p.startsWith("/stats/")) return send(res, 200, { snapshot: db.lastSnapshot ?? snapshot("post"), persona: { followers: 132, aura: 25, humor: 21 } });
  if (p === "/dms" && m === "GET") return send(res, 200, { threads: db.threads, followers: CHARACTERS.filter((c) => c.canBeFirstFollower) });
  if (p === "/dms" && m === "POST") {
    const ch = CHARACTERS.find((c) => c.id === b.characterId) ?? CHARACTERS[0];
    let thread = db.threads.find((t) => t.character.id === ch.id);
    if (!thread) {
      thread = { id: uid("t"), character: ch, lastMessage: null, lastMessageAt: now(), unreadCount: 0 };
      db.threads.push(thread);
      db.messages[thread.id] = [];
    }
    return send(res, 200, { thread });
  }
  const dmMsg = p.match(/^\/dms\/([^/]+)\/messages$/);
  if (dmMsg && m === "POST") {
    if (db.wallet.energy < 1) return fail(res, 402, "ENERGY_REQUIRED", "no energy");
    db.wallet.energy -= 1;
    const msg = { id: uid("dm"), fromCharacter: false, text: String(b.text ?? ""), generationId: null, createdAt: now() };
    (db.messages[dmMsg[1]] ??= []).push(msg);
    return send(res, 200, { message: msg, streamUrl: `/v1/dms/${dmMsg[1]}/stream` });
  }
  const dmStream = p.match(/^\/dms\/([^/]+)\/stream$/);
  if (dmStream) {
    const write = sse(res);
    const tid = dmStream[1];
    setTimeout(() => {
      const msg = { id: uid("dm"), fromCharacter: true, text: "girl. did you see gmz", generationId: uid("g"), createdAt: now() };
      (db.messages[tid] ??= []).push(msg);
      write("message", { message: msg });
    }, 400);
    setTimeout(() => { db.affinity += 2; write("affinity", { delta: 2, affinity: db.affinity }); }, 600);
    setTimeout(() => { write("done", { energy: db.wallet.energy }); res.end(); }, 800);
    return;
  }
  const dmGet = p.match(/^\/dms\/([^/]+)$/);
  if (dmGet && m === "GET") {
    const thread = db.threads.find((t) => t.id === dmGet[1]) ?? db.threads[0];
    if (!thread) return fail(res, 404, "NOT_FOUND", "no thread");
    return send(res, 200, {
      thread, messages: db.messages[thread.id] ?? [],
      relationship: { characterHandle: thread.character.handle, affinity: db.affinity, summary: "knows your worst takes", isFollower: true },
      nextCursor: null,
    });
  }
  if (p === "/wallet") return send(res, 200, db.wallet);
  if (p === "/wallet/ad-reward") {
    db.wallet.energy += 1;
    db.wallet.adRewardsToday += 1;
    return send(res, 200, { energy: db.wallet.energy, adRewardsToday: db.wallet.adRewardsToday });
  }
  if (p === "/wallet/coffee") {
    if (db.wallet.coffee < 1) return fail(res, 400, "VALIDATION", "no coffee");
    db.wallet.coffee -= 1;
    db.wallet.energy += 8;
    return send(res, 200, { energy: db.wallet.energy, coffee: db.wallet.coffee });
  }
  if (p === "/billing/offerings") {
    return send(res, 200, {
      plans: [
        { id: "plus_weekly", usd: 6.99, period: "week", highlighted: false },
        { id: "plus_monthly", usd: 14.99, period: "month", highlighted: true },
        { id: "plus_yearly", usd: 79.99, period: "year", highlighted: false },
      ],
      experiments: { trialDays: 7, showAdFree: true },
    });
  }
  if (p === "/billing/dev-purchase") {
    db.subscription = { plan: b.plan ?? "plus_monthly", active: true, renewsAt: now() };
    db.wallet.energy = 50;
    db.wallet.dailyMax = 50;
    db.wallet.adsEnabled = false;
    return send(res, 200, { subscription: db.subscription, energy: db.wallet.energy });
  }
  if (p.match(/^\/generations\/[^/]+\/rate$/)) {
    const replacement = b.regenerate ? mkPost("character", "hivequeenbea", "regenerated: this is the take of the year") : null;
    return send(res, 200, { replacement, newGenerationId: replacement ? replacement.generationId : null });
  }
  if (p === "/experiments/assignments") return send(res, 200, { paywall_copy: "A" });
  if (p === "/__test/reset") {
    db.user = { id: "u_1", locale: "en", isMinor: false, birthYear: null };
    db.wallet = { energy: 10, coffee: 2, gems: 0, dailyRefillAt: new Date(Date.now() + 6 * 3600e3).toISOString(), adRewardsToday: 0, adsEnabled: true, adPersonalized: false, dailyMax: 10 };
    db.subscription = null; db.persona = null; db.posts = []; db.actionCount = 0;
    db.pendingEvent = null; db.lastSnapshot = null; db.threads = []; db.messages = {}; db.affinity = 40;
    return send(res, 200, {});
  }
  if (p === "/__test/plus-off") {
    db.subscription = null;
    db.wallet.adsEnabled = true;
    db.wallet.dailyMax = 10;
    db.wallet.adRewardsToday = 0;
    return send(res, 200, {});
  }
  if (p === "/__test/set-energy") { db.wallet.energy = Number(b.energy ?? 0); return send(res, 200, {}); }
  return fail(res, 404, "NOT_FOUND", `no route ${p}`);
});

server.listen(port, () => console.log(`mock api on :${port}`));
