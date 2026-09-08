import { useEffect, useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

/** Resets document scroll on navigation, without reacting to background data refreshes. */
export function ScrollToTop() {
  const { key, hash } = useLocation();

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => { window.history.scrollRestoration = previous; };
  }, []);

  useLayoutEffect(() => {
    // Preserve intentional anchor navigation, including Skip To Content.
    if (!hash) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [key, hash]);

  return null;
}
