// Auditoria automática de acessibilidade (axe-core, regras WCAG 2.1 A e AA) das telas principais,
// nos temas claro e escuro. Parte da avaliação de usabilidade sem participantes (Experimento C).
// Uso (em apps/web): ACESSIBILIDADE=1 npx playwright test acessibilidade
//   → falha se houver violação grave ou crítica; relatório por tema em ../../dados/resultados/acessibilidade/
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { abrirSecao, entrar, sair } from "./ajuda";

test.skip(!process.env.ACESSIBILIDADE, "defina ACESSIBILIDADE=1 para rodar a auditoria");

interface Violacao { tela: string; tema: string; regra: string; impacto: string; ocorrencias: number; descricao: string }

// O Playwright reinicia o processo após uma falha, então cada teste grava o próprio relatório.
async function auditar(page: Page, tela: string, tema: string, telas: string[], violacoes: Violacao[]) {
  await page.waitForLoadState("networkidle");
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  telas.push(tela);
  for (const v of r.violations) {
    violacoes.push({ tela, tema, regra: v.id, impacto: v.impact ?? "?", ocorrencias: v.nodes.length, descricao: v.help });
  }
}

for (const tema of ["claro", "escuro"] as const) {
  test(`telas principais no tema ${tema}`, async ({ page }) => {
    test.setTimeout(180_000);
    const telas: string[] = [], violacoes: Violacao[] = [];
    const auditarTela = (tela: string) => auditar(page, tela, tema, telas, violacoes);
    await page.addInitScript((t) => localStorage.setItem("lord-tema", t), tema);
    await page.goto("/login");
    await auditarTela("login");
    await entrar(page, "aluna@lord.dev");
    await auditarTela("pacientes");
    await page.getByRole("link", { name: "Paciente Sintético 005" }).click();
    await auditarTela("paciente");
    await page.getByRole("link", { name: /Ficha inicial/ }).first().click();
    await auditarTela("ficha: queixa principal");
    await abrirSecao(page, /Questionário de dor/);
    await auditarTela("ficha: questionário de dor");
    await abrirSecao(page, /Exame clínico de DTM/);
    await auditarTela("ficha: exame (mapa de palpação)");
    await abrirSecao(page, /Odontograma/);
    await auditarTela("ficha: odontograma");
    await sair(page);
    await entrar(page, "coorte@lord.dev");
    await page.getByRole("link", { name: "Paciente Coorte C023" }).click();
    await page.getByRole("heading", { name: "Evolução clínica" }).waitFor();
    await auditarTela("evolução do paciente");
    await sair(page);
    await entrar(page, "professora@lord.dev");
    await auditarTela("fila de revisão");
    await page.getByRole("link", { name: "Painel" }).click();
    await page.getByRole("table", { name: /Variação da intensidade/ }).waitFor();
    await auditarTela("painel da coorte");

    const pasta = "../../dados/resultados/acessibilidade";
    mkdirSync(pasta, { recursive: true });
    writeFileSync(`${pasta}/violacoes-${tema}.json`, JSON.stringify({ tema, telas, violacoes }, null, 2), "utf-8");
    const graves = violacoes.filter((v) => v.impacto === "critical" || v.impacto === "serious");
    expect(graves, JSON.stringify(graves, null, 1)).toEqual([]);
  });
}
