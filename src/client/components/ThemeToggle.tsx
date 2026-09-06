import { ArrowRight, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { applyTheme, preferredTheme, savedTheme, THEME_STORAGE_KEY, type Theme } from "../lib/theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState(preferredTheme);
  const preference = useRef<Theme | null>(savedTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const syncSystem = () => {
      if (!preference.current) setTheme(media?.matches ? "dark" : "light");
    };
    const syncStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      preference.current = savedTheme();
      setTheme(preferredTheme());
    };
    media?.addEventListener("change", syncSystem);
    window.addEventListener("storage", syncStorage);
    return () => {
      media?.removeEventListener("change", syncSystem);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);

  const nextTheme = theme === "dark" ? "light" : "dark";
  const label = theme === "light" ? "Light Mode" : "Dark Mode";
  const nextLabel = nextTheme === "light" ? "Light Mode" : "Dark Mode";
  return (
    <button
      className="button button--secondary theme-toggle"
      type="button"
      aria-label={`${label}: Switch To ${nextLabel}`}
      title={theme === "light" ? "Light To Dark" : "Dark To Light"}
      onClick={() => {
        preference.current = nextTheme;
        applyTheme(nextTheme);
        setTheme(nextTheme);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        } catch {
          // The selected theme still works when browser storage is unavailable.
        }
      }}
    >
      {theme === "light" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      <ArrowRight aria-hidden="true" />
      {nextTheme === "light" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  );
}
