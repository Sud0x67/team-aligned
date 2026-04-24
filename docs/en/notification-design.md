# Notification Design

Source: [Chinese version](../notification-design.md)

## Scope

Define in-app and system notification behavior for TeamAligned.

## Policy Highlights

- No system notifications while app is foreground
- Group/mention/agent-message channels respect per-channel settings
- Notification click should route back to related conversation
- Read actions should clear notification entries

## Validation

Notification policy must be tested by both automation and manual foreground/background checks.
