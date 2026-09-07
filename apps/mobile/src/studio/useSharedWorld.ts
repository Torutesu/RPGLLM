import { useCallback, useEffect, useRef, useState } from "react";
import { api, type WorldFull } from "../api/client";
import type { WorldDetail } from "../api/types";

/**
 * One world, read the way a *recipient* is allowed to read it.
 *
 * `GET /v1/worlds/:id` answers anyone who may play the world — its creator, and anyone at all once
 * it is published, unlisted included. That is the endpoint the share link has to be built on
 * (QA-002): the studio's `GET /v1/worlds/:id/status` is creator-only, which is why the old link
 * was a 404 for everybody it was ever sent to.
 *
 * `status` is still asked for, once and without polling, because it carries what the detail
 * endpoint does not: the play count, the creator's handle and the world's own state. Today that
 * answers only for the creator and a visitor simply gets a page without those two numbers; the
 * moment the endpoint opens to whoever may play the world, the same page fills in. A refusal here
 * is never an error — the page is already on screen.
 */
export type SharedWorldState = {
  /** Cover, title, scenario and the cast — everything a recipient is shown. */
  detail: WorldDetail | null;
  /** The studio record, when this viewer is allowed to have it. */
  full: WorldFull | null;
  phase: "loading" | "ready" | "error";
  reload: () => Promise<void>;
};

export function useSharedWorld(worldId: string | null): SharedWorldState {
  const [detail, setDetail] = useState<WorldDetail | null>(null);
  const [full, setFull] = useState<WorldFull | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!worldId) return;
    const both = await Promise.allSettled([api.world(worldId), api.worldStatus(worldId)]);
    if (!alive.current) return;
    const [page, studio] = both;
    if (page.status === "fulfilled") {
      setDetail(page.value);
      setPhase("ready");
    } else {
      // A world already on screen is never replaced by an error: a dropped reload keeps the page.
      setPhase((p) => (p === "ready" ? p : "error"));
    }
    if (studio.status === "fulfilled") setFull(studio.value.world);
  }, [worldId]);

  useEffect(() => {
    alive.current = true;
    setDetail(null);
    setFull(null);
    setPhase("loading");
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  return { detail, full, phase, reload: load };
}
