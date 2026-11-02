import { useSyncExternalStore } from "react";
import { zhCN, zhCNPatterns } from "./i18n/zh-CN";

export type Locale = "en" | "zh-CN";

export const LOCALE_STORAGE_KEY = "server-check-language";

function savedLocale(): Locale {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY) === "zh-CN" ? "zh-CN" : "en";
  } catch {
    return "en";
  }
}

/** The page language. It changes without a reload, so read it at render rather than at module load. */
export let locale: Locale = typeof localStorage === "undefined" ? "en" : savedLocale();

/** Locale for Intl date and number formatting. */
export let intlLocale = locale === "zh-CN" ? "zh-CN" : "en-US";

if (typeof document !== "undefined") document.documentElement.lang = locale;

function translatePattern(source: string): string {
  const match = zhCNPatterns.find(([pattern]) => pattern.test(source));
  return match ? source.replace(match[0], match[1]) : source;
}

/**
 * Translates English source text; text without a translation, such as a raw API diagnostic, stays as written.
 * {0}, {1}, … are filled from args, so a translation can reorder them.
 */
export function t(source: string, ...args: (string | number)[]): string {
  const text = locale === "zh-CN" ? zhCN[source] ?? translatePattern(source) : source;
  return args.length ? text.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)])) : text;
}

/** A value built for the current language and rebuilt only when it changes, such as an Intl formatter. */
export function perLocale<T>(build: () => T): () => T {
  let builtFor: Locale | undefined;
  let value: T;
  return () => {
    if (builtFor !== locale) {
      value = build();
      builtFor = locale;
    }
    return value;
  };
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders the calling component, and everything it renders, when the language changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, () => locale);
}

export function chooseLocale(next: Locale): void {
  if (next === locale) return;
  locale = next;
  intlLocale = next === "zh-CN" ? "zh-CN" : "en-US";
  document.documentElement.lang = next;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    // The choice still applies until this page is closed.
  }
  listeners.forEach((listener) => listener());
}
