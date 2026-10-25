import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds the React sections into ../assets/islands as one script and one stylesheet,
// so the main site stays plain HTML that GitHub Pages serves as-is.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  base: "./",
  build: {
    outDir: "../assets/islands",
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: "src/main.jsx",
      output: {
        entryFileNames: "islands.js",
        assetFileNames: "islands[extname]",
        inlineDynamicImports: true,
      },
    },
  },
});
