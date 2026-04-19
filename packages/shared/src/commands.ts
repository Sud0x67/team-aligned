import type { SlashCommand } from "./types.ts";

const supportedCommands = new Set([
  "skills",
  "mcp",
]);

export function parseSlashCommand(input: string): SlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const [rawName, ...args] = trimmed.slice(1).split(/\s+/);
  const name = rawName.toLowerCase();

  if (!supportedCommands.has(name)) {
    return null;
  }

  return {
    raw: trimmed,
    name: name as SlashCommand["name"],
    args,
  };
}

export const commandSuggestions = [
  { name: "/skills", description: "查看、切换或启用当前 Agent 可用技能" },
  { name: "/mcp", description: "查看并调用当前可用的 MCP 能力" },
];
