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

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
