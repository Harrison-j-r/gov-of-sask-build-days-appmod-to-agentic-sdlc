import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "ui",
  base: "./",
  build: { outDir: "../public", emptyOutDir: true, sourcemap: false },
});
