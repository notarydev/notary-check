import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// `entryFileNames: "mcp-app.html"` (an earlier attempt at this config) does NOT
// work: it renames the JS entry chunk itself to end in ".html", which makes
// vite-plugin-singlefile misclassify that chunk as an HTML template it should
// inline into (it matches /\.html?$/) rather than as the JS to inline — the
// chunk has no `.source` (only `.code`), so the plugin crashes with
// "Cannot read properties of undefined (reading 'replace')". Confirmed by
// building it, not by inspection. Leave entry naming at Vite's default and
// rename the actual HTML output file after the build instead (see
// package.json's "build" script).
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist",
  },
});
