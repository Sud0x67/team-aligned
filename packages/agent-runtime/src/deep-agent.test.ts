import test from "node:test";
import assert from "node:assert/strict";
import {
  extractStreamReasoningText,
  normalizeProviderErrorMessage,
  validateProviderForSingleChat,
} from "./deep-agent.ts";

const provider = {
  id: "qwen" as const,
  label: "百炼 (DashScope)",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  defaultModel: "qwen3.6-plus",
};

test("normalizes authentication related provider errors", () => {
  const message = normalizeProviderErrorMessage("401 Unauthorized: invalid_api_key", provider);
  assert.match(message, /鉴权失败/);
});

test("normalizes aliyun-style apikey error with troubleshooting url", () => {
  const raw = [
    "401 Incorrect API key provided. For details, see: https://help.aliyun.com/zh/model-studio/error-code#apikey-error",
    "Troubleshooting URL: https://help.aliyun.com/zh/model-studio/error-code#apikey-error",
  ].join("\n");
  const message = normalizeProviderErrorMessage(raw, provider);
  assert.match(message, /鉴权失败/);
  assert.match(message, /排查参考：https:\/\/help\.aliyun\.com\/zh\/model-studio\/error-code#apikey-error/);
});

test("normalizes timeout related provider errors", () => {
  const message = normalizeProviderErrorMessage("request timed out after 120000ms", provider);
  assert.match(message, /超时/);
  assert.match(message, /Base URL/);
});

test("normalizes model-not-found provider errors", () => {
  const message = normalizeProviderErrorMessage("404 model not found", provider);
  assert.match(message, /模型不可用/);
});

test("normalizes nested network errors from provider sdk", () => {
  const error = {
    message: "Connection error.",
    cause: {
      message: "fetch failed",
      cause: {
        message: "getaddrinfo ENOTFOUND dashscope.aliyuncs.com",
        code: "ENOTFOUND",
      },
    },
  };
  const message = normalizeProviderErrorMessage(error, provider);
  assert.match(message, /无法连接到/);
  assert.match(message, /Base URL/);
});

test("normalizes nested auth errors from provider sdk", () => {
  const error = {
    message: "Connection error.",
    error: {
      message: "401 Incorrect API key provided",
      type: "invalid_request_error",
    },
  };
  const message = normalizeProviderErrorMessage(error, provider);
  assert.match(message, /鉴权失败/);
});

test("falls back to raw error text for unknown errors", () => {
  const raw = "some custom backend error";
  const message = normalizeProviderErrorMessage(raw, provider);
  assert.equal(message, raw);
});

test("normalizes provider timeout errors in English", () => {
  const message = normalizeProviderErrorMessage("request timed out after 120000ms", provider, "en");
  assert.match(message, /timed out/i);
  assert.match(message, /Base URL/);
});

test("returns English provider validation message when provider is missing", () => {
  const issue = validateProviderForSingleChat(null, "en");
  assert.match(issue ?? "", /No model provider is available/i);
});

test("extractStreamReasoningText reads explicit provider reasoning fields", () => {
  assert.equal(
    extractStreamReasoningText({
      additional_kwargs: {
        reasoning_content: "I am checking the uploaded image.",
      },
    }),
    "I am checking the uploaded image.",
  );
});

test("extractStreamReasoningText reads typed reasoning content parts", () => {
  assert.equal(
    extractStreamReasoningText({
      content: [
        {
          type: "thinking",
          text: "I need to inspect the workspace first.",
        },
      ],
    }),
    "I need to inspect the workspace first.",
  );
});
