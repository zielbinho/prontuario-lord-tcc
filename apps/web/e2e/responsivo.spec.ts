// RNF04: as telas principais cabem na largura de um tablet na vertical, sem rolagem horizontal.
import { expect, test, type Page } from "@playwright/test";
import { abrirSecao, entrar, sair } from "./ajuda";

test.use({ viewport: { width: 768, height: 1024 } });

async function semRolagemHorizontal(page: Page, tela: string) {
  await page.waitForLoadState("networkidle");
  const { largura, janela } = await page.evaluate(() => ({
    largura: document.documentElement.scrollWidth, janela: document.documentElement.clientWidth,
  }));
  expect(largura, `${tela}: a página tem ${largura}px numa janela de ${janela}px`).toBeLessThanOrEqual(janela);
}

test("telas principais sem rolagem horizontal em 768 px", async ({ page }) => {
  await entrar(page, "aluna@lord.dev");
  await semRolagemHorizontal(page, "pacientes");
  await page.getByRole("link", { name: "Paciente Sintético 005" }).click();
  await semRolagemHorizontal(page, "paciente");
  await page.getByRole("link", { name: /Ficha inicial/ }).first().click();
  for (const secao of [/Queixa principal/, /Questionário de dor/, /Exame clínico de DTM/, /Odontograma/]) {
    await abrirSecao(page, secao);
    await semRolagemHorizontal(page, `ficha: ${secao.source}`);
  }
  await sair(page);
  await entrar(page, "professora@lord.dev");
  await semRolagemHorizontal(page, "fila de revisão");
  await sair(page);
  await entrar(page, "admin@lord.dev");
  await page.goto("/auditoria");
  await page.getByRole("heading", { name: "Trilha de auditoria" }).waitFor();
  await semRolagemHorizontal(page, "auditoria");
});
