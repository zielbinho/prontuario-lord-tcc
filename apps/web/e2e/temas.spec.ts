// Revisão visual das telas principais nos temas claro e escuro (não faz asserções de pixels).
// Uso (em apps/web): VISUAL=1 npx playwright test temas  → capturas em test-results/temas/
import { expect, test } from "@playwright/test";
import { abrirSecao, entrar, sair } from "./ajuda";

test.skip(!process.env.VISUAL, "defina VISUAL=1 para gerar as capturas de revisão visual");

for (const tema of ["claro", "escuro"] as const) {
  test(`telas no tema ${tema}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript((t) => localStorage.setItem("lord-tema", t), tema);
    const capturar = async (nome: string) => {
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `test-results/temas/${tema}-${nome}.png`, fullPage: true });
    };

    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("data-tema", tema);
    await capturar("01-login");
    await entrar(page, "aluna@lord.dev");
    await capturar("02-pacientes");
    await page.getByRole("link", { name: "Paciente Sintético 003" }).click();
    await capturar("03-paciente");
    await page.getByRole("link", { name: /Ficha inicial/ }).first().click();
    await abrirSecao(page, /Exame clínico de DTM/);
    await capturar("04-ficha-exame");
    await sair(page);

    await entrar(page, "coorte@lord.dev");
    await page.getByRole("link", { name: "Paciente Coorte C023" }).click();
    await page.getByRole("heading", { name: "Evolução clínica" }).waitFor();
    await capturar("05-evolucao");
    await sair(page);

    await entrar(page, "professora@lord.dev");
    await capturar("06-revisao");
    await page.getByRole("link", { name: "Painel" }).click();
    await page.getByRole("table", { name: /Variação da intensidade/ }).waitFor();
    await capturar("07-painel");
  });
}
