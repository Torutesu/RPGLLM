/**
 * Types derived from the shared zod contracts without importing zod here
 * (`packages/shared` owns the schemas; this app only consumes them).
 */
import type {
  MeResZ, WalletZ, PersonaZ, WorldSummaryZ, WorldDetailResZ, CharacterZ, PresetPersonaZ,
  EventZ, StatSnapshotZ, FeedResZ, DMThreadZ, DMMessageZ, RelationshipZ, DMListResZ,
  DMThreadResZ, OfferingsResZ, SubscriptionZ, PostDetailResZ, CreatePostResZ, SendDMResZ,
  ChooseEventResZ, AuthResZ, AgeGateResZ, RateResZ, AdRewardResZ, CoffeeResZ,
  DevPurchaseResZ, CreatePersonaResZ, HandleCheckResZ, StatResZ,
} from "@rpgllm/shared";

export type Infer<S> = S extends { parse: (x: unknown) => infer T } ? T : never;

export type Me = Infer<typeof MeResZ>;
export type Wallet = Infer<typeof WalletZ>;
export type Persona = Infer<typeof PersonaZ>;
export type Subscription = Infer<typeof SubscriptionZ>;
export type WorldSummary = Infer<typeof WorldSummaryZ>;
export type WorldDetail = Infer<typeof WorldDetailResZ>;
export type Character = Infer<typeof CharacterZ>;
export type PresetPersona = Infer<typeof PresetPersonaZ>;
export type GameEvent = Infer<typeof EventZ>;
export type StatSnapshot = Infer<typeof StatSnapshotZ>;
export type FeedRes = Infer<typeof FeedResZ>;
export type PostDetail = Infer<typeof PostDetailResZ>;
export type CreatePostRes = Infer<typeof CreatePostResZ>;
export type DMThread = Infer<typeof DMThreadZ>;
export type DMMessage = Infer<typeof DMMessageZ>;
export type Relationship = Infer<typeof RelationshipZ>;
export type DMList = Infer<typeof DMListResZ>;
export type DMThreadRes = Infer<typeof DMThreadResZ>;
export type SendDMRes = Infer<typeof SendDMResZ>;
export type Offerings = Infer<typeof OfferingsResZ>;
export type ChooseEventRes = Infer<typeof ChooseEventResZ>;
export type AuthRes = Infer<typeof AuthResZ>;
export type AgeGateRes = Infer<typeof AgeGateResZ>;
export type RateRes = Infer<typeof RateResZ>;
export type AdRewardRes = Infer<typeof AdRewardResZ>;
export type CoffeeRes = Infer<typeof CoffeeResZ>;
export type DevPurchaseRes = Infer<typeof DevPurchaseResZ>;
export type CreatePersonaRes = Infer<typeof CreatePersonaResZ>;
export type HandleCheckRes = Infer<typeof HandleCheckResZ>;
export type StatRes = Infer<typeof StatResZ>;
