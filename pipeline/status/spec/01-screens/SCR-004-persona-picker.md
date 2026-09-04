# SCR-004: Persona Picker
- route: /onboarding/persona?worldId=
- auth: authenticated
- purpose: "Who do you want to play as?" — プリセット・ペルソナ 7 種から選ぶ、またはカスタムへ

## Layout
```
★★ Become a popstar
"Who do you want to play as?"
   (av)      (av)
 @hivequeen @sixdrey
(av)   [(av) 選択中]   (av)
 @ari   @taytay19    @dune
   (av)      (av)
 @jbsorry  @kingkay
[ Create my own ]                      [ Continue ]
```

## Components
| Component | Behavior | Data |
|---|---|---|
| PersonaGrid | 円形アバター。選択で青枠+ハンドル強調 | World preset personas(JSON in bible.presets) |
| CreateOwn | SCR-005 へ | - |
| Continue | 選択済みなら SCR-006 | - |

## States
- loading: スケルトン
- empty: n/a
- error: Retry
- success: グリッド

## Interactions
- アバタータップ → 選択状態
- Continue → SCR-006(draft persona を state に保持、まだ保存しない)
- Create my own → SCR-005

## AI Behaviors
- none
