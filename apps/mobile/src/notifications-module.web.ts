import type { NotificationsModule } from "./push";

/**
 * Web: there is no push here at all. `src/push.ts` returns before it ever reads this, but the null
 * keeps `expo-notifications` out of the web bundle even if a future call site forgets to check.
 */
export const notificationsModule: NotificationsModule | null = null;
