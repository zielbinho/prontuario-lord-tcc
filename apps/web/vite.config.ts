import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Em desenvolvimento, /api é repassado à API local, como o Caddy faz em produção
    proxy: {
      "/api": { target: "http://127.0.0.1:3333", rewrite: (caminho) => caminho.replace(/^\/api/, "") },
    },
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"], // e2e/ é do Playwright
    setupFiles: ["./test/preparar.ts"],
    css: false,
  },
});
