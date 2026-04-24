# Maintenance Guidelines

Source: [Chinese version](../maintenance-guidelines.md)

## Goal

Keep the codebase clean, stable, and maintainable during beta hardening.

## Rules

- Prefer simplification over additive abstraction
- Remove transitional logic once no longer needed
- Protect behavior with tests before refactors
- Keep docs and TODO status synchronized with real implementation

## Verification

Every maintenance pass should end with typecheck, lint, tests, and risk notes.
