/** The visual system. Components in `src/components` are assembled from these. */
export { Gradient, GradientRule, Scrim, type GradientProps } from "./Gradient";
export { Icon, iconNames, type IconName, type IconProps } from "./Icon";
export { Avatar, type AvatarProps, type AvatarBadge } from "./Avatar";
export { typo, eyebrow, usingFallbackFaces, type TypeRole } from "./type";
export { useFontsLoaded, fontsLoaded } from "./fonts";
export {
  ease,
  duration,
  timing,
  useAnimatedValue,
  useHaptic,
  useOnChange,
  NATIVE_DRIVER,
  useReduceMotion,
  type HapticKind,
} from "./motion";
export { AnimatedNumber, Burst, FadeSlideIn, PressScale, Pulse, Shimmer, type AnimatedNumberProps } from "./anim";
