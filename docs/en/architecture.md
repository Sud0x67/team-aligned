# Architecture

Source: [Chinese version](../architecture.md)

## Scope

This document describes the architecture as currently implemented in the repository.

## System Layers

- Electron desktop shell
- React renderer and product UI
- Local agent runtime (`packages/agent-runtime`)
- Local persistence layer (SQLite + file assets)

## Core Runtime Responsibilities

- Single-agent chat execution
- Group-chat orchestration with handoff state
- Skill registry, MCP registry, and tool execution
- Run lifecycle, artifacts, attachments, and message persistence

## Current Focus

The architecture is now in beta-hardening mode: stabilize experience, improve observability, and reduce transition-only code.
