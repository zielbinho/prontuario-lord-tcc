import { defineConfig } from "@playwright/test";

// Testes de ponta a ponta com o Microsoft Edge instalado no sistema (sem baixar navegadores).
// Usam o ambiente de desenvolvimento (API com dados sintéticos + interface); se já estiverem
// rodando, são reaproveitados. Com PRODUCAO=1, a interface é a versão COMPILADA, servida com os
// mesmos cabeçalhos de segurança (CSP) da implantação:  PRODUCAO=1 npx playwright test fluxo-ficha
const producao = !!process.env.PRODUCAO;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: producao ? "http://localhost:4173" : "http://localhost:5173",
    channel: "msedge",
    viewport: { width: 1280, height: 800 },
    locale: "pt-BR",
    colorScheme: "light",
    trace: "retain-on-failure",
  },
  webServer: [
    { command: "npm run dev -w @lord/api", cwd: "../..", port: 3333, reuseExistingServer: true, timeout: 120_000 },
    producao
      ? { command: "npm run build -w @lord/web && npm run preview -w @lord/web", cwd: "../..", port: 4173, reuseExistingServer: true, timeout: 120_000 }
      : { command: "npm run dev -w @lord/web", cwd: "../..", port: 5173, reuseExistingServer: true, timeout: 60_000 },
  ],
});
