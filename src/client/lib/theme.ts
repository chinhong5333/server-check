export type Theme = "light" | "dark";
export const THEME_STORAGE_KEY = "server-check-theme";

export function savedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function preferredTheme(): Theme {
  return savedTheme() ?? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

/**
 * Sets the page theme. With `animate`, the change cross-fades through a View Transition, which also covers the
 * canvas charts that CSS transitions cannot reach. Without browser support, or with reduced motion, it switches at once.
 */
export function applyTheme(theme: Theme, animate = false): void {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (!animate || reduceMotion || !root.dataset.theme || typeof document.startViewTransition !== "function") {
    root.dataset.theme = theme;
    return;
  }
  document.startViewTransition(() => { root.dataset.theme = theme; });
}
