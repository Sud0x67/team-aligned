# Skill Registry Design

Source: [Chinese version](../skill-registry-design.md)

## Purpose

Define skill catalog, install/remove lifecycle, and runtime usage model.

## Coverage

- Skill catalog synchronization
- Install, enable, disable, remove flow
- Skill whitelist behavior at agent level
- Standard runtime Skill progressive disclosure:
  - inject only allowlisted Skill catalog summaries into prompts
  - use `skill_load` to read full `SKILL.md` when a task matches a Skill description
  - use `skill_read_file` for bundled `references/`, `templates/`, and `assets/`
  - use `skill_run_script` for bundled scripts, still protected by execution confirmation policy

## UX Requirement

Skill status changes should be visible, responsive, and recoverable.

## Runtime Tools

- `skill_list`: list allowlisted installed Skills for the current Agent.
- `skill_load`: load full `SKILL.md` on demand.
- `skill_read_file`: read bundled Skill files.
- `skill_run_script`: run supported scripts under `scripts/`.

The runtime no longer injects full `SKILL.md` content by default and no longer creates per-Skill dynamic tool names.
