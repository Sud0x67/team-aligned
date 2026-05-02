import test from "node:test";
import assert from "node:assert/strict";
import type { ProviderConfig } from "@teamaligned/shared";
import { runWebFetch, runWebSearch } from "./web-tools.ts";

const provider: ProviderConfig = {
  id: "openai",
  label: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-test",
  defaultModel: "gpt-4.1",
  supportsToolCalling: true,
  supportsStreaming: true,
  isActive: true,
};

test("web_fetch fetches a valid http page and extracts content", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      "<html><head><title>Example</title></head><body><main><h1>Hello</h1><p>TeamAligned Web</p></main></body></html>",
      {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );

  const result = await runWebFetch({
    url: "https://example.com",
    fetchImpl,
    extractMode: "text",
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.title, "Example");
  assert.match(result.content, /Hello/);
  assert.match(result.content, /TeamAligned Web/);
});

test("web_fetch aborts on timeout", async () => {
  const fetchImpl: typeof fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      signal?.addEventListener("abort", () => {
        reject(new Error("aborted"));
      });
    });

  await assert.rejects(
    () =>
      runWebFetch({
        url: "https://example.com/slow",
        fetchImpl,
        timeoutMs: 25,
      }),
    /aborted/i,
  );
});

test("web_fetch marks oversized responses as truncated", async () => {
  const payload = "A".repeat(2_000);
  const fetchImpl: typeof fetch = async () =>
    new Response(payload, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });

  const result = await runWebFetch({
    url: "https://example.com/huge",
    fetchImpl,
    maxResponseBytes: 128,
    maxChars: 1_000,
    extractMode: "text",
  });

  assert.equal(result.truncated, true);
  assert.ok(result.content.length <= 1_003);
});

test("web_fetch rejects too many redirects", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("", {
      status: 302,
      headers: { location: "https://example.com/redirect" },
    });

  await assert.rejects(
    () =>
      runWebFetch({
        url: "https://example.com/start",
        fetchImpl,
        maxRedirects: 1,
      }),
    /Too many redirects/i,
  );
});

test("web_fetch rejects non-http urls", async () => {
  await assert.rejects(
    () =>
      runWebFetch({
        url: "file:///tmp/demo.txt",
      }),
    /Only http\(s\) URLs are supported/,
  );
});

test("web_search prefers provider-native backend when available", async () => {
  const fetchImpl: typeof fetch = async (url) => {
    assert.match(String(url), /\/responses$/);
    return new Response(
      JSON.stringify({
        output_text: "Top matches found.",
        output: [
          {
            type: "web_search_call",
            action: {
              sources: [
                {
                  title: "LangChain Docs",
                  url: "https://python.langchain.com",
                  snippet: "Build with LangChain",
                },
              ],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const result = await runWebSearch({
    provider,
    query: "langchain",
    fetchImpl,
  });

  assert.equal(result.backend, "provider_native");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.title, "LangChain Docs");
  assert.match(result.references[0] ?? "", /^https:\/\//);
});

test("web_search falls back when provider-native backend fails", async () => {
  let callCount = 0;
  const fetchImpl: typeof fetch = async (url) => {
    callCount += 1;
    if (String(url).includes("/responses")) {
      return new Response(JSON.stringify({ error: { message: "unsupported tool" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      [
        '<html><body><a class="result__a" href="https://example.com/a">Result A</a>',
        '<span class="result__snippet">Snippet A</span>',
        "</body></html>",
      ].join(""),
      {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  };

  const result = await runWebSearch({
    provider,
    query: "teamaligned",
    fetchImpl,
  });

  assert.equal(result.backend, "fallback");
  assert.ok(callCount >= 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.title, "Result A");
});

test("web_search returns empty fallback results when no hits found", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("<html><body><div>No results</div></body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });

  const result = await runWebSearch({
    provider: null,
    query: "no-result-query",
    fetchImpl,
  });

  assert.equal(result.backend, "fallback");
  assert.equal(result.items.length, 0);
});
