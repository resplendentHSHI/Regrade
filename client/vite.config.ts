import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { execFileSync } from "child_process";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

function gitShortSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"]).toString().trim();
  } catch {
    // @ts-expect-error process
    return (process.env.GITHUB_SHA as string)?.slice(0, 7) || "dev";
  }
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  define: {
    // @ts-expect-error process is a nodejs global
    __GOOGLE_CLIENT_ID__: JSON.stringify(process.env.GOOGLE_CLIENT_ID || ""),
    // @ts-expect-error process is a nodejs global
    __GOOGLE_CLIENT_SECRET__: JSON.stringify(process.env.GOOGLE_CLIENT_SECRET || ""),
    __BUILD_COMMIT__: JSON.stringify(gitShortSha()),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
