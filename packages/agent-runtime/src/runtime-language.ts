export type RuntimeLanguage = "zh" | "en";

function countMatches(text: string, pattern: RegExp) {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

export function detectRuntimeLanguage(input: string, fallback: RuntimeLanguage = "zh"): RuntimeLanguage {
  const text = input.trim();
  if (!text) {
    return fallback;
  }

  const hanCount = countMatches(text, /[\u3400-\u9FFF]/g);
  const latinCount = countMatches(text, /[A-Za-z]/g);

  if (hanCount === 0 && latinCount === 0) {
    return fallback;
  }

  if (hanCount >= 2 && hanCount >= latinCount) {
    return "zh";
  }

  if (latinCount >= 2 && latinCount > hanCount) {
    return "en";
  }

  return hanCount > 0 ? "zh" : "en";
}

export function byLanguage<T>(language: RuntimeLanguage, value: { zh: T; en: T }) {
  return language === "en" ? value.en : value.zh;
}

export function formatList(items: string[], language: RuntimeLanguage) {
  if (items.length === 0) {
    return byLanguage(language, { zh: "无", en: "none" });
  }
  return language === "en" ? items.join(", ") : items.join("、");
}
