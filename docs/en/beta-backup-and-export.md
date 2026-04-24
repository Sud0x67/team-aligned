# Beta Backup and Export

Source: [Chinese version](../beta-backup-and-export.md)

## Goal

Define a safe backup and export flow for beta users so local-first data can be retained and recovered.

## Covered Data

- Profile and settings
- Conversations and messages
- Runs, run steps, tool invocations
- Artifacts and attachments under `~/.teamaligned`

## Principles

- Export should be predictable and reversible
- Recovery should avoid destructive overwrite by default
- Backup docs should be operational, not theoretical
