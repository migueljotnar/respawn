import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
      },
    },
  },
  preview: {
    host: "localhost",
    port: 4173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
      },
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
});
