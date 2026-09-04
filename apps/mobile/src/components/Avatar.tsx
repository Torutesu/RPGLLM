/**
 * The avatar lives in `src/ui/Avatar.tsx` (generated SVG portraits). This module keeps the import
 * path every screen already uses.
 *
 * An avatar always sits next to the handle it belongs to, so by default it is decorative and is
 * taken out of the accessibility tree; a caller that renders one on its own passes `label` to get
 * an image role with a name instead.
 */
export { Avatar, type AvatarProps, type AvatarBadge } from "../ui/Avatar";
