import test from "node:test";
import assert from "node:assert/strict";
import { commandSuggestions, parseSlashCommand } from "./commands.ts";

test("parseSlashCommand parses /skills with args", () => {
  const result = parseSlashCommand("/skills use planner");
  assert.deepEqual(result, {
    raw: "/skills use planner",
    name: "skills",
    args: ["use", "planner"],
  });
});

test("parseSlashCommand parses /mcp with args", () => {
  const result = parseSlashCommand("  /mcp tools  ");
  assert.deepEqual(result, {
    raw: "/mcp tools",
    name: "mcp",
    args: ["tools"],
  });
});

test("parseSlashCommand returns null for unsupported slash", () => {
  assert.equal(parseSlashCommand("/pause"), null);
  assert.equal(parseSlashCommand("/designer"), null);
});

test("parseSlashCommand returns null for plain text", () => {
  assert.equal(parseSlashCommand("hello team"), null);
});

test("command suggestions include core slash commands", () => {
  const names = commandSuggestions.map((item) => item.name);
  assert.ok(names.includes("/skills"));
  assert.ok(names.includes("/mcp"));
});
