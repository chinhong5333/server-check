import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Dev server only: fill the link-preview URL placeholder. In production Express injects the runtime PUBLIC_BASE_URL. */
function publicBaseUrlPlaceholder(origin: string): Plugin {
  return {
    name: "public-base-url-placeholder",
    apply: "serve",
    transformIndexHtml: (html) => html.replaceAll("__PUBLIC_BASE_URL__", origin)
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const origin = env.PUBLIC_BASE_URL ? new URL(env.PUBLIC_BASE_URL).origin : "http://127.0.0.1:5173";
  return {
    plugins: [react(), publicBaseUrlPlaceholder(origin)],
    build: {
      outDir: "dist/client",
      emptyOutDir: true,
      sourcemap: true
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": "http://127.0.0.1:3000"
      }
    }
  };
});
