import { defineConfig } from "@playwright/test";

// Testes de ponta a ponta com o Microsoft Edge instalado no sistema (sem baixar navegadores).
// Usam o ambiente de desenvolvimento (API com dados sintéticos + interface); se já estiverem
// rodando, são reaproveitados.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    channel: "msedge",
    viewport: { width: 1280, height: 800 },
    locale: "pt-BR",
    colorScheme: "light",
    trace: "retain-on-failure",
  },
  webServer: [
    { command: "npm run dev -w @lord/api", cwd: "../..", port: 3333, reuseExistingServer: true, timeout: 120_000 },
    { command: "npm run dev -w @lord/web", cwd: "../..", port: 5173, reuseExistingServer: true, timeout: 60_000 },
  ],
});
