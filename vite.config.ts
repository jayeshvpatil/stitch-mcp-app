import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    rollupOptions: {
      input: process.env.INPUT || "mcp-app.html",
      output: {
        inlineDynamicImports: true,
      },
    },
    sourcemap: process.env.NODE_ENV === "development" ? "inline" : false,
  },
});
