import test from "node:test";
import assert from "node:assert/strict";
import { byLanguage, detectRuntimeLanguage, formatList } from "./runtime-language.ts";

test("detectRuntimeLanguage prefers English for latin-dominant input", () => {
  assert.equal(detectRuntimeLanguage("Please review this PR and summarize risks."), "en");
});

test("detectRuntimeLanguage prefers Chinese for han-dominant input", () => {
  assert.equal(detectRuntimeLanguage("请帮我检查这个功能并总结风险。"), "zh");
});

test("detectRuntimeLanguage falls back on empty input", () => {
  assert.equal(detectRuntimeLanguage("   ", "en"), "en");
});

test("byLanguage returns language-specific value", () => {
  assert.equal(byLanguage("zh", { zh: "你好", en: "hello" }), "你好");
  assert.equal(byLanguage("en", { zh: "你好", en: "hello" }), "hello");
});

test("formatList joins content with locale-specific separators", () => {
  assert.equal(formatList(["a", "b", "c"], "en"), "a, b, c");
  assert.equal(formatList(["甲", "乙", "丙"], "zh"), "甲、乙、丙");
  assert.equal(formatList([], "en"), "none");
  assert.equal(formatList([], "zh"), "无");
});
