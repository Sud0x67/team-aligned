import type { ProviderConfig } from "@teamaligned/shared";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_FETCH_CHARS = 8_000;
const MAX_FETCH_CHARS = 32_000;
const DEFAULT_SEARCH_RESULTS = 5;
const MAX_SEARCH_RESULTS = 8;

type FetchLike = typeof fetch;

type ResponsePayload = {
  status: number;
  statusText: string;
  finalUrl: string;
  contentType: string;
  text: string;
  truncatedBytes: boolean;
};

export type WebFetchExtractMode = "markdown" | "text";

export type WebFetchResult = {
  requestedUrl: string;
  finalUrl: string;
  title: string | null;
  extractMode: WebFetchExtractMode;
  contentType: string;
  statusCode: number;
  chars: number;
  truncated: boolean;
  content: string;
};

export type WebSearchResultItem = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearchResult = {
  query: string;
  backend: "provider_native" | "fallback";
  items: WebSearchResultItem[];
  summary: string | null;
  references: string[];
};

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseCharset(contentType: string) {
  const matched = contentType.match(/charset=([^;]+)/i);
  return matched?.[1]?.trim() || "utf-8";
}

function decodeHtmlEntities(input: string) {
  return input
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function stripHtmlToText(html: string) {
  const withoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  const withBreaks = withoutScripts
    .replace(/<\/(p|div|h\d|li|section|article|main|tr|ul|ol|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const withoutTags = withBreaks.replace(/<[^>]+>/g, " ");
  const decoded = decodeHtmlEntities(withoutTags);
  return decoded
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractTitle(html: string) {
  const matched = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!matched?.[1]) return null;
  const text = decodeHtmlEntities(matched[1]).replace(/\s+/g, " ").trim();
  return text || null;
}

function extractMainHtml(html: string) {
  const mainMatched = html.match(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i);
  if (mainMatched?.[0]) {
    return mainMatched[0];
  }
  const bodyMatched = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatched?.[1] ?? html;
}

function toMarkdown(result: {
  title: string | null;
  url: string;
  content: string;
  truncated: boolean;
}) {
  const lines = [];
  if (result.title) {
    lines.push(`# ${result.title}`);
    lines.push("");
  }
  lines.push(`Source: ${result.url}`);
  lines.push("");
  lines.push(result.content);
  if (result.truncated) {
    lines.push("");
    lines.push("_Content truncated due to safety limits._");
  }
  return lines.join("\n").trim();
}

async function readResponseText(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncatedBytes: boolean }> {
  if (!response.body) {
    const fallbackBuffer = Buffer.from(await response.arrayBuffer());
    const text = new TextDecoder(parseCharset(response.headers.get("content-type") ?? "utf-8"), {
      fatal: false,
    }).decode(fallbackBuffer.subarray(0, maxBytes));
    return {
      text,
      truncatedBytes: fallbackBuffer.byteLength > maxBytes,
    };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncatedBytes = false;

  while (true) {
    const result = await reader.read();
    if (result.done) break;

    const value = result.value;
    if (!value || value.byteLength === 0) continue;

    const remaining = maxBytes - size;
    if (remaining <= 0) {
      truncatedBytes = true;
      await reader.cancel();
      break;
    }

    if (value.byteLength > remaining) {
      chunks.push(value.subarray(0, remaining));
      size += remaining;
      truncatedBytes = true;
      await reader.cancel();
      break;
    }

    chunks.push(value);
    size += value.byteLength;
  }

  const merged = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  const contentType = response.headers.get("content-type") ?? "utf-8";
  const text = new TextDecoder(parseCharset(contentType), { fatal: false }).decode(merged);
  return {
    text,
    truncatedBytes,
  };
}

async function fetchPageWithGuards(input: {
  url: string;
  timeoutMs: number;
  maxResponseBytes: number;
  maxRedirects: number;
  fetchImpl?: FetchLike;
}): Promise<ResponsePayload> {
  let currentUrl = input.url;
  const fetchImpl = input.fetchImpl ?? fetch;

  for (let redirectCount = 0; redirectCount <= input.maxRedirects; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "teamaligned-web-fetch/1.0",
          accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.8",
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`Redirect response (${response.status}) missing Location header.`);
      }
      if (redirectCount >= input.maxRedirects) {
        throw new Error(`Too many redirects (>${input.maxRedirects}).`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const body = await readResponseText(response, input.maxResponseBytes);
    return {
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url || currentUrl,
      contentType,
      text: body.text,
      truncatedBytes: body.truncatedBytes,
    };
  }

  throw new Error("Unexpected redirect handling failure.");
}

function sanitizeSnippet(value: string, maxChars: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars)}...`;
}

function parseDuckDuckGoHtml(html: string, maxResults: number): WebSearchResultItem[] {
  const items: WebSearchResultItem[] = [];
  const resultRegex =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<span[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/span>)?/gi;
  while (items.length < maxResults) {
    const match = resultRegex.exec(html);
    if (!match) break;
    const rawUrl = decodeHtmlEntities(match[1] ?? "").trim();
    if (!rawUrl) continue;

    let url = rawUrl;
    try {
      const parsed = new URL(rawUrl, "https://duckduckgo.com");
      if (parsed.pathname === "/l/" && parsed.searchParams.has("uddg")) {
        url = decodeURIComponent(parsed.searchParams.get("uddg") ?? rawUrl);
      } else {
        url = parsed.toString();
      }
    } catch {
      // keep raw value when URL parsing fails.
    }

    const title = sanitizeSnippet(stripHtmlToText(match[2] ?? ""), 180);
    const snippet = sanitizeSnippet(stripHtmlToText(match[3] ?? match[4] ?? ""), 260);
    if (!title || !isHttpUrl(url)) continue;
    items.push({
      title,
      url,
      snippet,
    });
  }
  return items;
}

async function searchWithDuckDuckGo(input: {
  query: string;
  maxResults: number;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}): Promise<WebSearchResultItem[]> {
  const endpoint = `https://duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`;
  const payload = await fetchPageWithGuards({
    url: endpoint,
    timeoutMs: input.timeoutMs,
    maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    maxRedirects: 2,
    fetchImpl: input.fetchImpl,
  });
  return parseDuckDuckGoHtml(payload.text, input.maxResults);
}

function extractProviderResponseText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!item || typeof item !== "object") continue;
      const maybeItem = item as Record<string, unknown>;
      if (Array.isArray(maybeItem.content)) {
        const merged = maybeItem.content
          .map((entry) => {
            if (!entry || typeof entry !== "object") return "";
            const record = entry as Record<string, unknown>;
            if (typeof record.text === "string") return record.text;
            if (typeof record.output_text === "string") return record.output_text;
            return "";
          })
          .filter(Boolean)
          .join("\n")
          .trim();
        if (merged) return merged;
      }
    }
  }
  return null;
}

function extractProviderSources(payload: Record<string, unknown>, maxResults: number): WebSearchResultItem[] {
  const items: WebSearchResultItem[] = [];
  if (!Array.isArray(payload.output)) {
    return items;
  }

  for (const outputEntry of payload.output) {
    if (!outputEntry || typeof outputEntry !== "object") continue;
    const entry = outputEntry as Record<string, unknown>;
    const action = entry.action;
    if (!action || typeof action !== "object") continue;
    const sources = (action as Record<string, unknown>).sources;
    if (!Array.isArray(sources)) continue;

    for (const source of sources) {
      if (items.length >= maxResults) break;
      if (!source || typeof source !== "object") continue;
      const record = source as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title.trim() : "";
      const url = typeof record.url === "string" ? record.url.trim() : "";
      const snippet =
        typeof record.snippet === "string"
          ? sanitizeSnippet(record.snippet, 260)
          : typeof record.summary === "string"
            ? sanitizeSnippet(record.summary, 260)
            : "";
      if (!title || !isHttpUrl(url)) continue;
      items.push({ title, url, snippet });
    }
  }

  return items;
}

async function searchWithProviderNative(input: {
  provider: ProviderConfig;
  query: string;
  maxResults: number;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}): Promise<{ items: WebSearchResultItem[]; summary: string | null }> {
  const endpoint = new URL(
    "responses",
    input.provider.baseUrl.endsWith("/") ? input.provider.baseUrl : `${input.provider.baseUrl}/`,
  ).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.provider.apiKey}`,
      },
      body: JSON.stringify({
        model: input.provider.defaultModel,
        input: input.query,
        tools: [{ type: "web_search" }],
        include: ["web_search_call.action.sources"],
      }),
    });

    const text = await response.text();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error("Provider-native web search returned non-JSON response.");
    }

    if (!response.ok) {
      const message =
        (typeof payload.error === "object" &&
          payload.error &&
          typeof (payload.error as Record<string, unknown>).message === "string" &&
          (payload.error as Record<string, unknown>).message) ||
        `Provider-native web search failed (${response.status}).`;
      throw new Error(String(message));
    }

    const items = extractProviderSources(payload, input.maxResults);
    const summary = extractProviderResponseText(payload);
    if (items.length === 0) {
      throw new Error("Provider-native web search did not return sources.");
    }
    return { items, summary };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runWebFetch(input: {
  url: string;
  extractMode?: WebFetchExtractMode;
  maxChars?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  fetchImpl?: FetchLike;
}): Promise<WebFetchResult> {
  const requestedUrl = input.url.trim();
  if (!isHttpUrl(requestedUrl)) {
    throw new Error("Only http(s) URLs are supported.");
  }

  const extractMode = input.extractMode === "markdown" ? "markdown" : "text";
  const timeoutMs = clampNumber(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000, MAX_TIMEOUT_MS);
  const maxResponseBytes = clampNumber(input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, 64_000, 10 * 1024 * 1024);
  const maxRedirects = clampNumber(input.maxRedirects ?? 4, 0, 8);
  const maxChars = clampNumber(input.maxChars ?? DEFAULT_MAX_FETCH_CHARS, 512, MAX_FETCH_CHARS);

  const payload = await fetchPageWithGuards({
    url: requestedUrl,
    timeoutMs,
    maxResponseBytes,
    maxRedirects,
    fetchImpl: input.fetchImpl,
  });

  const mainHtml = /html/i.test(payload.contentType) ? extractMainHtml(payload.text) : payload.text;
  const extracted = stripHtmlToText(mainHtml);
  const truncatedByChars = extracted.length > maxChars;
  const content = truncatedByChars ? `${extracted.slice(0, maxChars)}...` : extracted;
  const title = /html/i.test(payload.contentType) ? extractTitle(payload.text) : null;
  const finalContent =
    extractMode === "markdown"
      ? toMarkdown({
          title,
          url: payload.finalUrl,
          content,
          truncated: payload.truncatedBytes || truncatedByChars,
        })
      : content;

  return {
    requestedUrl,
    finalUrl: payload.finalUrl,
    title,
    extractMode,
    contentType: payload.contentType || "unknown",
    statusCode: payload.status,
    chars: finalContent.length,
    truncated: payload.truncatedBytes || truncatedByChars,
    content: finalContent,
  };
}

export async function runWebSearch(input: {
  provider: ProviderConfig | null;
  query: string;
  maxResults?: number;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}): Promise<WebSearchResult> {
  const query = input.query.trim();
  if (!query) {
    throw new Error("Query cannot be empty.");
  }

  const timeoutMs = clampNumber(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000, MAX_TIMEOUT_MS);
  const maxResults = clampNumber(input.maxResults ?? DEFAULT_SEARCH_RESULTS, 1, MAX_SEARCH_RESULTS);

  if (input.provider) {
    try {
      const nativeResult = await searchWithProviderNative({
        provider: input.provider,
        query,
        maxResults,
        timeoutMs,
        fetchImpl: input.fetchImpl,
      });
      return {
        query,
        backend: "provider_native",
        items: nativeResult.items,
        summary: nativeResult.summary,
        references: nativeResult.items.map((item) => item.url),
      };
    } catch {
      // Fallback below.
    }
  }

  const items = await searchWithDuckDuckGo({
    query,
    maxResults,
    timeoutMs,
    fetchImpl: input.fetchImpl,
  });

  return {
    query,
    backend: "fallback",
    items,
    summary: null,
    references: items.map((item) => item.url),
  };
}
