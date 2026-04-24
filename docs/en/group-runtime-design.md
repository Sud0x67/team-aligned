# Group Runtime Design

Source: [Chinese version](../group-runtime-design.md)

## Scope

Document the runtime implementation for team/group conversations.

## Runtime Responsibilities

- Speaker selection and mention resolution
- Handoff state normalization and transition
- Team update events and process visibility
- Tool invocation observation and run persistence

## Design Principle

Keep orchestration deterministic enough for stability while preserving natural conversational flow.
