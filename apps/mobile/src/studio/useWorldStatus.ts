import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type WorldStatusRes } from "../api/client";
import { isBuilding } from "./labels";

/** How often a building world is asked how it is doing, and how long a stalled poll keeps trying. */
const POLL_MS = 1600;
const MAX_CONSECUTIVE_ERRORS = 4;

export type WorldStatusState = {
  data: WorldStatusRes | null;
  /** `loading` only before the first answer; after that the last good answer stays on screen. */
  phase: "loading" | "ready" | "error";
  /** True when the last poll failed but an earlier one succeeded — the screen says so quietly. */
  stale: boolean;
  reload: () => Promise<void>;
};

/**
 * Polls `GET /v1/worlds/:id/status` until the world stops moving.
 *
 * Written to degrade honestly rather than crash: while WS-API is still landing the endpoint may
 * 404, and a phone loses its network mid-build all the time. A failure never clears what is
 * already on screen; four failures in a row stop the timer and hand the player a retry.
 */
export function useWorldStatus(worldId: string | null): WorldStatusState {
  const [data, setData] = useState<WorldStatusRes | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [stale, setStale] = useState(false);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const tick = useCallback(
    async (id: string) => {
      try {
        const next = await api.worldStatus(id);
        if (!alive.current) return;
        failures.current = 0;
        setData(next);
        setStale(false);
        setPhase("ready");
        if (isBuilding(next.world.status)) {
          timer.current = setTimeout(() => void tick(id), POLL_MS);
        }
      } catch (e) {
        if (!alive.current) return;
        failures.current += 1;
        // A world that is genuinely not there is terminal; anything else is worth another try.
        const gone = e instanceof ApiError && e.status === 404 && failures.current >= 2;
        if (failures.current >= MAX_CONSECUTIVE_ERRORS || gone) {
          setPhase((p) => (p === "ready" ? p : "error"));
          setStale(true);
          stop();
          return;
        }
        setStale(true);
        timer.current = setTimeout(() => void tick(id), POLL_MS * failures.current);
      }
    },
    [stop],
  );

  const reload = useCallback(async () => {
    if (!worldId) return;
    failures.current = 0;
    stop();
    await tick(worldId);
  }, [worldId, stop, tick]);

  useEffect(() => {
    alive.current = true;
    failures.current = 0;
    setData(null);
    setPhase("loading");
    setStale(false);
    if (worldId) void tick(worldId);
    return () => {
      alive.current = false;
      stop();
    };
  }, [worldId, tick, stop]);

  return { data, phase, stale, reload };
}
