# SCR-041: Invite(リファラル)
- route: /invite
- auth: authenticated
- purpose: AIF/成長。招待でエネルギーを配り、獲得コストを下げる

## Layout
```
[← Invite friends]
You both get a coffee (8 energy) when a friend joins with your code.
YOUR CODE
   K7QP2M9X              [ Copy link ]
   3 friends joined
HAVE A CODE?
   [ ________ ]  [ Redeem ]
```

## Components
| Component | Behavior | Data |
|---|---|---|
| CodeBox | `T.referralCode` / `T.referralCopy` | ReferralRes.code, link |
| Counter | 招待人数と獲得コーヒー | ReferralRes.invited, coffeeEarned |
| RedeemBox | `T.referralRedeemInput` / `T.referralRedeem` | RedeemReferralRes |

## States
- loading: スケルトン
- empty: 招待 0 人
- error: 自己招待・二重利用・期限切れはインラインエラー
- success: 双方に `REFERRAL.*_COFFEE` を付与(`LedgerEntry.source=referral`)

## Interactions
- Redeem は**ペルソナ未作成、または登録から 1 日以内**のアカウントのみ

## AI Behaviors
- none
