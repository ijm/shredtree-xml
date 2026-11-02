import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// base "./": every asset URL is relative, so the same build works from a local
// preview server and from a GitHub Pages project path without knowing the repo name
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  // pyodide finds its runtime files from indexURL, which pre-bundling would break
  optimizeDeps: { exclude: ["pyodide"] },
  // the scenarios are read from ../data, shared with the Python tests
  server: { fs: { allow: [".."] } },
});
