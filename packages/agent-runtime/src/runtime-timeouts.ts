export type RuntimeTimeouts = {
  singleChatModelMs: number;
  teamOrchestratorMs: number;
  teamWorkerMs: number;
  teamWorkerStreamIdleMs: number;
  mcpConnectMs: number;
  mcpToolMs: number;
  webToolMs: number;
  webToolMaxMs: number;
};

export const defaultRuntimeTimeouts: RuntimeTimeouts = {
  singleChatModelMs: 10 * 60 * 1000,
  teamOrchestratorMs: 90 * 1000,
  teamWorkerMs: 20 * 60 * 1000,
  teamWorkerStreamIdleMs: 2 * 60 * 1000,
  mcpConnectMs: 60 * 1000,
  mcpToolMs: 5 * 60 * 1000,
  webToolMs: 30 * 1000,
  webToolMaxMs: 2 * 60 * 1000,
};

function readPositiveNumber(
  env: NodeJS.ProcessEnv,
  names: string[],
  fallback: number,
) {
  for (const name of names) {
    const raw = env[name];
    if (!raw) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) {
      return Math.round(value);
    }
  }
  return fallback;
}

export function resolveRuntimeTimeouts(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeTimeouts {
  const webToolMaxMs = readPositiveNumber(
    env,
    ["TA_WEB_TOOL_MAX_TIMEOUT_MS"],
    defaultRuntimeTimeouts.webToolMaxMs,
  );
  const webToolMs = Math.min(
    readPositiveNumber(env, ["TA_WEB_TOOL_TIMEOUT_MS"], defaultRuntimeTimeouts.webToolMs),
    webToolMaxMs,
  );

  return {
    singleChatModelMs: readPositiveNumber(
      env,
      ["TA_SINGLE_CHAT_MODEL_TIMEOUT_MS", "TA_MODEL_TIMEOUT_MS"],
      defaultRuntimeTimeouts.singleChatModelMs,
    ),
    teamOrchestratorMs: readPositiveNumber(
      env,
      ["TA_TEAM_ORCHESTRATOR_TIMEOUT_MS"],
      defaultRuntimeTimeouts.teamOrchestratorMs,
    ),
    teamWorkerMs: readPositiveNumber(
      env,
      ["TA_TEAM_WORKER_TIMEOUT_MS"],
      defaultRuntimeTimeouts.teamWorkerMs,
    ),
    teamWorkerStreamIdleMs: readPositiveNumber(
      env,
      ["TA_TEAM_WORKER_STREAM_IDLE_TIMEOUT_MS"],
      defaultRuntimeTimeouts.teamWorkerStreamIdleMs,
    ),
    mcpConnectMs: readPositiveNumber(
      env,
      ["TA_MCP_CONNECT_TIMEOUT_MS"],
      defaultRuntimeTimeouts.mcpConnectMs,
    ),
    mcpToolMs: readPositiveNumber(
      env,
      ["TA_MCP_TOOL_TIMEOUT_MS"],
      defaultRuntimeTimeouts.mcpToolMs,
    ),
    webToolMs,
    webToolMaxMs,
  };
}

export function getRuntimeTimeouts() {
  return resolveRuntimeTimeouts(process.env);
}
