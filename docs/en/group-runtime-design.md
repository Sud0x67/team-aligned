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

## Current Runtime Shape

Group chat uses:

```text
handoff state machine + messages/updates dual output + execution subagents
```

The goal is that users can tell who started, who is continuing, who is waiting, and what finished without seeing internal scheduler terms.

## Handoff And Intent Rules

- Explicit `@Agent` always takes priority and moves that Agent to the front of the turn.
- If an explicit `@Agent` request is execution-like, that Agent must become an execution work-item owner. If the orchestrator omits the mentioned Agent or misclassifies the turn as chat, the runtime falls back to a safe execution plan that includes the mentioned Agent.
- Without explicit `@`, the orchestrator decides whether the turn is `focused`, `multi_voice`, or `collaboration`, then selects the most relevant members.
- Agent-to-Agent `@` messages update handoff state for the next sub-round.
- Handoff state is persisted after each turn so the next user message can continue naturally.

## Messages And Updates

Runtime output has two tracks:

- `messages`: public chat bubbles, including streaming Agent text and short natural process messages.
- `updates`: internal run updates used by the “thinking / in progress” UI.

Tool calls are now translated into short public process messages such as:

- “I’ll quickly scan the existing files and context first.”
- “I’m starting to apply this change to files.”
- “Command finished. I’ll continue.”
- “I hit a problem during read_text_file: ...”

These messages carry `teamProcess` metadata and are filtered out of the next orchestrator history, so tool log chatter does not pollute intent recognition.

## Execution Limits

- Up to `5` Agents per team turn.
- Up to `5` sub-rounds per team turn.
- Up to `10` messages per Agent per turn.
- Up to `50` Agent messages per team turn.
- Up to `5` work items per Agent per turn.
- Up to `5` parallel work items at the same time.

## Clear And Cancel

- `/clear` removes conversation messages, runs, transcripts, team memory, and resets handoff state.
- Cancel stops the active run, finalizes streaming messages, resets handoff, and adds a public team message saying the turn was cancelled.
