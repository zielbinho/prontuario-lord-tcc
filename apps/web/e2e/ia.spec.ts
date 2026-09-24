// Fluxo do ditado com o MODELO REAL (Ollama + qwen2.5:3b): lento em CPU e dependente do modelo,
// por isso só roda com IA=1. Também gera a figura da tela de revisão de sugestões do TCC.
// Uso (em apps/web): IA=1 npx playwright test ia
import { expect, test } from "@playwright/test";
import { abrirSecao, entrar } from "./ajuda";

test.skip(!process.env.IA, "defina IA=1 (requer Ollama e o modelo qwen2.5:3b)");

// Relato de desenvolvimento para o caso sintético 012, do conjunto de AJUSTE (ver dados/sinteticos/casos/indice.csv):
// casos de teste nunca são usados para desenvolver ou ajustar o sistema.
const RELATO =
  "Trabalha como motorista de aplicativo. Fez uma restauração há quatro meses. Tem gastrite. " +
  "Não fuma, não bebe e não usa drogas. Toma metformina 850 mg faz seis meses. Acorda várias vezes à noite. " +
  "Nega ansiedade ou depressão. Nunca fez cirurgia e não tem alergia. Contou que a filha passou no vestibular.";

test("aluno dita a história médica, revisa e decide cada sugestão", async ({ page }) => {
  test.setTimeout(360_000);
  await entrar(page, "aluno@lord.dev");
  await page.getByRole("link", { name: "Paciente Sintético 012" }).click();
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

  // rejeita o que veio do comentário irrelevante (se o modelo o transformou em sugestão) e aceita o restante
  const irrelevante = lista.filter({ hasText: "vestibular" });
  if (await irrelevante.count()) await irrelevante.first().getByRole("button", { name: "Rejeitar" }).click();
  const pendentes = page.getByRole("button", { name: /Aceitar as \d+ pendentes/ });
  if (await pendentes.count()) await pendentes.click();
  else await lista.first().getByRole("button", { name: "Aceitar" }).click();
  await expect(lista.first().getByText(/Aceita|Rejeitada/)).toBeVisible();

  await page.getByLabel("Ditado com IA").screenshot({ path: "../../docs/figuras/11-revisao-ia.png" });
  console.log("sugestões:", caminhos.join(", "));
});
