import test from "node:test";
import assert from "node:assert/strict";
import { buildChildProcessEnv } from "./process-env.ts";

test("buildChildProcessEnv keeps runtime essentials and redacts ambient secrets by default", () => {
  const env = buildChildProcessEnv(
    {},
    {
      PATH: "/usr/bin",
      HOME: "/Users/alex",
      LANG: "en_US.UTF-8",
      OPENAI_API_KEY: "sk-secret",
      SLACK_CLIENT_SECRET: "secret",
      AUTHORIZATION: "Bearer token",
    },
  );

  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/Users/alex");
  assert.equal(env.LANG, "en_US.UTF-8");
  assert.equal("OPENAI_API_KEY" in env, false);
  assert.equal("SLACK_CLIENT_SECRET" in env, false);
  assert.equal("AUTHORIZATION" in env, false);
});

test("buildChildProcessEnv applies configured overrides and explicit allowlist", () => {
  const env = buildChildProcessEnv(
    {
      SLACK_CLIENT_SECRET: "configured-secret",
      CUSTOM_FLAG: "enabled",
    },
    {
      PATH: "/usr/bin",
      TEAMALIGNED_CHILD_ENV_ALLOWLIST: "OPENAI_API_KEY, EXTRA_ALLOWED",
      OPENAI_API_KEY: "sk-opted-in",
      EXTRA_ALLOWED: "ok",
      OTHER_SECRET: "hidden",
    },
  );

  assert.equal(env.OPENAI_API_KEY, "sk-opted-in");
  assert.equal(env.EXTRA_ALLOWED, "ok");
  assert.equal(env.SLACK_CLIENT_SECRET, "configured-secret");
  assert.equal(env.CUSTOM_FLAG, "enabled");
  assert.equal("OTHER_SECRET" in env, false);
});
