// Fluxo do ditado com o MODELO REAL (Ollama + qwen2.5:3b): lento em CPU e dependente do modelo,
// por isso só roda com IA=1. Também gera a figura da tela de revisão de sugestões do TCC.
// Uso (em apps/web): IA=1 npx playwright test ia
import { expect, test } from "@playwright/test";
import { abrirSecao, entrar } from "./ajuda";

test.skip(!process.env.IA, "defina IA=1 (requer Ollama e o modelo qwen2.5:3b)");

// Relato de desenvolvimento escrito para o caso sintético 004 (não faz parte da base do Experimento A)
const RELATO =
  "A paciente conta que tem asma desde criança, mas está controlada. Fez cesárea em 2018. " +
  "Não tem alergia a nenhum remédio e não toma medicação nenhuma no momento. Dorme mal, acorda várias vezes à noite. " +
  "Fumou por muitos anos, mas parou faz uns dez anos. Trabalha como operadora de telemarketing e diz que vive " +
  "preocupada com a família. Fez uma restauração há quatro meses. Comentou que o ônibus atrasou hoje.";

test("aluno dita a história médica, revisa e decide cada sugestão", async ({ page }) => {
  test.setTimeout(360_000);
  await entrar(page, "aluno@lord.dev");
  await page.getByRole("link", { name: "Paciente Sintético 004" }).click();
  await page.getByRole("link", { name: /Ficha inicial/ }).first().click();
  await abrirSecao(page, /História médica/);

  await page.getByRole("button", { name: "Ditado com IA" }).click();
  await page.getByLabel(/Relato/).fill(RELATO);
  await page.getByRole("button", { name: "Gerar sugestões" }).click();
  const lista = page.locator("[data-sugestao]");
  await expect(lista.first()).toBeVisible({ timeout: 300_000 });

  // nenhuma sugestão de seção clínica; toda sugestão tem trecho de evidência entre aspas
  const caminhos = await lista.evaluateAll((els) => els.map((e) => e.getAttribute("data-sugestao")));
  expect(caminhos.every((c) => c?.startsWith("historia_medica."))).toBe(true);
  for (const item of await lista.all()) await expect(item.getByText(/^“.+”$/)).toBeVisible();

  // decide a primeira e a última para a figura mostrar os dois estados
  await lista.first().getByRole("button", { name: "Aceitar" }).click();
  if ((await lista.count()) > 1) await lista.last().getByRole("button", { name: "Rejeitar" }).click();
  await expect(lista.first().getByText(/Aceita/)).toBeVisible();

  await page.getByLabel("Ditado com IA").screenshot({ path: "../../docs/figuras/11-revisao-ia.png" });
  console.log("sugestões:", caminhos.join(", "));
});
