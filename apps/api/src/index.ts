import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();
app.use("*", cors());
app.get("/v1/health", (c) => c.json({ data: { ok: true, llmMode: process.env.LLM_MODE ?? "replay", champion: {} }, error: null }));

const port = Number(process.env.PORT ?? 4000);
serve({ fetch: app.fetch, port }, () => console.log(`api listening on :${port}`));
export default app;
