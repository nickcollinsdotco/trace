import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Set by `tauri dev` when developing against a device on the network.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // Tauri points the webview at a fixed port; it must not wander.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // Spread rather than `hmr: undefined` — exactOptionalPropertyTypes
    // distinguishes "absent" from "explicitly undefined".
    ...(host ? { hmr: { protocol: "ws" as const, host, port: 1421 } } : {}),
    watch: {
      // src-tauri is Rust; cargo watches it, vite should not.
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    target: "esnext",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
