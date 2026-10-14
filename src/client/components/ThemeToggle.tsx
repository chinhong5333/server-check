import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { applyTheme, savedTheme, THEME_STORAGE_KEY, type Theme } from "../lib/theme";

type ThemePreference = Theme | "system";

const options = [
  { value: "light", label: "Light Theme", Icon: Sun },
  { value: "dark", label: "Dark Theme", Icon: Moon },
  { value: "system", label: "System Theme", Icon: Monitor }
] as const;

function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/** Segmented theme control: an explicit choice is remembered; System follows the operating system. */
export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(() => savedTheme() ?? "system");
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const theme: Theme = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const syncSystem = () => setSystemDark(media?.matches ?? false);
    const syncStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      setPreference(savedTheme() ?? "system");
    };
    media?.addEventListener("change", syncSystem);
    window.addEventListener("storage", syncStorage);
    return () => {
      media?.removeEventListener("change", syncSystem);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);

  function choose(next: ThemePreference) {
    setPreference(next);
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // The selected theme still works when browser storage is unavailable.
    }
  }

  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {options.map(({ value, label, Icon }) => (
        <button key={value} className="theme-toggle__option" type="button" aria-label={label} title={label}
          aria-pressed={preference === value} onClick={() => choose(value)}>
          <Icon aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
