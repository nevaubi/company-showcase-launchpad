import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  root: __dirname,
  base: "./",
  plugins: [react(), tailwind()],
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
  build: { outDir: path.resolve(__dirname, "dist"), emptyOutDir: true, cssCodeSplit: false, assetsInlineLimit: 100_000_000, rollupOptions: { output: { inlineDynamicImports: true } } },
});
