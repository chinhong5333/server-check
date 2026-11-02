import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../src/client/i18n/zh-CN";

const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every literal handed to t(), including the `t(count === 1 ? "One" : "Many")` form. */
function usedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of sourceFiles("src/client")) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bt\(\s*("(?:[^"\\]|\\.)*")/g)) keys.add(JSON.parse(match[1]));
    for (const match of source.matchAll(/\bt\([^"()]*\?\s*("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
      keys.add(JSON.parse(match[1]));
      keys.add(JSON.parse(match[2]));
    }
    for (const match of source.matchAll(/\["(\{0\} [A-Za-z]+)", "(\{0\} [A-Za-z]+)"\]/g)) {
      keys.add(match[1]);
      keys.add(match[2]);
    }
  }
  return keys;
}

describe("Simplified Chinese dictionary", () => {
  it("translates every string the client passes to t()", () => {
    const keys = usedKeys();
    expect(keys.size).toBeGreaterThan(700);
    expect([...keys].filter((key) => !(key in zhCN))).toEqual([]);
  });

  it("keeps every placeholder in each translation", () => {
    const broken = Object.entries(zhCN).filter(([source, text]) => placeholders(source).join() !== placeholders(text).join());
    expect(broken).toEqual([]);
  });
});

describe("t", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function loadWith(saved: string | null) {
    vi.resetModules();
    vi.stubGlobal("localStorage", { getItem: () => saved, setItem: vi.fn() });
    return import("../../src/client/i18n");
  }

  it("stays in English unless Chinese was chosen", async () => {
    const { locale, intlLocale, t } = await loadWith(null);
    expect([locale, intlLocale]).toEqual(["en", "en-US"]);
    expect(t("Delete {0}?", "web-01")).toBe("Delete web-01?");
    expect((await loadWith("fr")).locale).toBe("en");
  });

  it("translates, reorders values, and passes unknown diagnostics through unchanged", async () => {
    const { locale, intlLocale, t } = await loadWith("zh-CN");
    expect([locale, intlLocale]).toEqual(["zh-CN", "zh-CN"]);
    expect(t("Delete Agent")).toBe("删除探针");
    expect(t("{0} For {1}", "Nginx", "web-01")).toBe("web-01 的 Nginx");
    expect(t("Storage is low on /var")).toBe("/var 存储空间不足");
    expect(t("HTTP 503 from upstream")).toBe("HTTP 503 from upstream");
  });
});
