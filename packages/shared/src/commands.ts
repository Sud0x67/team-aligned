import type { SlashCommand } from "./types.ts";

const supportedCommands = new Set([
  "skills",
  "mcp",
  "clear",
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
  { name: "/skills", description: "View, switch, or enable skills for the current Agent" },
  { name: "/mcp", description: "View and call available MCP capabilities" },
  { name: "/clear", description: "Clear conversation history and reset context" },
];
