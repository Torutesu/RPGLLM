# SCR-005: Persona Editor
- route: /onboarding/persona/edit
- auth: authenticated
- purpose: ハンドル・表示名・bio・口調メモを入力(プリセット選択時はプリフィル)

## Layout
```
[アバター(生成済みスタイライズド画像から選択 12 種)]
@[handle_____]   ✓ available
[Display name]
[Bio (≤160)]
[How do you talk? (optional, ≤200)]
[ Save & continue ]
```

## Components
| Component | Behavior | Data |
|---|---|---|
| AvatarPicker | 事前生成の非実在アバター(実在人物風は使わない) | avatarUrl |
| HandleField | 英数_ 3〜15、World 内一意を `GET /personas/check` で確認 | Persona.handle |
| BioField / VoiceField | 文字数カウンタ | bio, voiceNotes |

## States
- loading: 保存中はボタン disabled
- empty: プリフィルなし(カスタム)
- error: handle 重複 "Taken"、バリデーション赤字
- success: SCR-006

## Interactions
- Save → state 保持 → SCR-006

## AI Behaviors
- none(AIF-004 の口調自動抽出は P1)
