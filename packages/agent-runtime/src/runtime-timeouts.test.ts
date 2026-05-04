import test from "node:test";
import assert from "node:assert/strict";
import { defaultRuntimeTimeouts, resolveRuntimeTimeouts } from "./runtime-timeouts.ts";

test("resolveRuntimeTimeouts returns long-task defaults", () => {
  assert.deepEqual(resolveRuntimeTimeouts({}), defaultRuntimeTimeouts);
});

test("resolveRuntimeTimeouts honors environment overrides and aliases", () => {
  const resolved = resolveRuntimeTimeouts({
    TA_MODEL_TIMEOUT_MS: "12345",
    TA_TEAM_ORCHESTRATOR_TIMEOUT_MS: "90001",
    TA_TEAM_WORKER_TIMEOUT_MS: "1200001",
    TA_TEAM_WORKER_STREAM_IDLE_TIMEOUT_MS: "120001",
    TA_MCP_CONNECT_TIMEOUT_MS: "60001",
    TA_MCP_TOOL_TIMEOUT_MS: "300001",
    TA_WEB_TOOL_TIMEOUT_MS: "45000",
    TA_WEB_TOOL_MAX_TIMEOUT_MS: "90000",
  });

  assert.equal(resolved.singleChatModelMs, 12345);
  assert.equal(resolved.teamOrchestratorMs, 90001);
  assert.equal(resolved.teamWorkerMs, 1200001);
  assert.equal(resolved.teamWorkerStreamIdleMs, 120001);
  assert.equal(resolved.mcpConnectMs, 60001);
  assert.equal(resolved.mcpToolMs, 300001);
  assert.equal(resolved.webToolMs, 45000);
  assert.equal(resolved.webToolMaxMs, 90000);
});

test("resolveRuntimeTimeouts ignores invalid overrides and caps web timeout", () => {
  const resolved = resolveRuntimeTimeouts({
    TA_SINGLE_CHAT_MODEL_TIMEOUT_MS: "0",
    TA_TEAM_ORCHESTRATOR_TIMEOUT_MS: "-1",
    TA_MCP_CONNECT_TIMEOUT_MS: "not-a-number",
    TA_WEB_TOOL_TIMEOUT_MS: "90000",
    TA_WEB_TOOL_MAX_TIMEOUT_MS: "30000",
  });

  assert.equal(resolved.singleChatModelMs, defaultRuntimeTimeouts.singleChatModelMs);
  assert.equal(resolved.teamOrchestratorMs, defaultRuntimeTimeouts.teamOrchestratorMs);
  assert.equal(resolved.mcpConnectMs, defaultRuntimeTimeouts.mcpConnectMs);
  assert.equal(resolved.webToolMs, 30000);
  assert.equal(resolved.webToolMaxMs, 30000);
});
