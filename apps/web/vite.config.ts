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
  // "npm run preview -w @lord/web": a interface compilada com os MESMOS cabeçalhos de segurança do
  // Caddy (implantacao/Caddyfile), para verificar que a CSP não quebra nada antes da implantação
  preview: {
    port: 4173,
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
        "media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "microphone=(self), camera=(), geolocation=(), payment=()",
    },
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
