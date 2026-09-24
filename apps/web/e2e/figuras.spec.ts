// Gera as capturas de tela usadas como figuras no TCC (capítulo de resultados).
// Uso: FIGURAS=1 npx playwright test figuras   → imagens em docs/figuras/
import { test, type Page } from "@playwright/test";
import { abrirSecao, entrar } from "./ajuda";

const PASTA = "../../docs/figuras";

test.skip(!process.env.FIGURAS, "defina FIGURAS=1 para gerar as figuras");

async function capturar(pagina: Page, nome: string, paginaInteira = false) {
  await pagina.waitForLoadState("networkidle");
  await pagina.screenshot({ path: `${PASTA}/${nome}.png`, fullPage: paginaInteira });
}

test("figuras da interface", async ({ page }) => {
  await page.goto("/login");
  await capturar(page, "01-login");

  await entrar(page, "aluna@lord.dev");
  await capturar(page, "02-pacientes");

  // paciente sintético com ficha aprovada (dados completos do gerador)
  await page.getByRole("link", { name: "Paciente Sintético 005" }).click();
  await capturar(page, "03-paciente");

  await page.getByRole("link", { name: /Ficha inicial/ }).first().click();
  await abrirSecao(page, /História médica/);
  await capturar(page, "04-ficha-historia-medica");

  await abrirSecao(page, /Questionário de dor/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await capturar(page, "05-ficha-questionario-dor");

  // paciente com perfil de DTM muscular: o mapa e o diagnóstico ficam mais ilustrativos
  await page.getByRole("link", { name: "Pacientes" }).click();
  await page.getByRole("link", { name: "Paciente Sintético 003" }).click();
  await page.getByRole("link", { name: /Ficha inicial/ }).first().click();
  await abrirSecao(page, /Exame clínico de DTM/);
  // só o componente, para a figura ficar legível no documento impresso
  await page.locator("div.p-3", { has: page.getByRole("group", { name: /Mapa de palpação/ }) })
    .screenshot({ path: `${PASTA}/06-mapa-palpacao.png` });

  await abrirSecao(page, /Eixo I/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await capturar(page, "07-diagnostico-somente-humano");

  await page.getByRole("button", { name: "Sair" }).click();
  await entrar(page, "professora@lord.dev");
  await capturar(page, "09-fila-revisao");

  await page.getByRole("button", { name: "Sair" }).click();
  await entrar(page, "admin@lord.dev");
  await page.getByRole("link", { name: "Auditoria" }).click();
  await capturar(page, "10-auditoria");

  // Odontograma: marcações de exemplo numa ficha em rascunho, sem salvar (os dados não mudam)
  await page.getByRole("button", { name: "Sair" }).click();
  await entrar(page, "aluno@lord.dev");
  await page.getByRole("link", { name: "Paciente Sintético 004" }).click();
  await page.getByRole("link", { name: /Ficha inicial/ }).first().click();
  await abrirSecao(page, /Odontograma/);
  const face = (dente: number, f: string) =>
    page.locator("polygon").filter({ has: page.locator("title", { hasText: new RegExp(`^${dente} ${f}$`) }) });
  await page.getByRole("radio", { name: "Cárie" }).click();
  await face(36, "O").click();
  await face(15, "D").click();
  await page.getByRole("radio", { name: "Restauração" }).click();
  for (const [d, f] of [[46, "O"], [46, "M"], [26, "O"], [11, "M"]] as const) await face(d, f).click();
  await page.getByRole("radio", { name: "Lesão cervical não cariosa" }).click();
  await face(13, "V").click();
  await face(23, "V").click();
  for (const dente of [48, 38]) {
    await page.getByRole("button", { name: `Dente ${dente}` }).click();
    await page.getByLabel("Ausente").check();
  }
  await page.getByRole("button", { name: "Dente 36" }).click();
  await page.getByRole("button", { name: "Tratamento endodôntico" }).click();
  await page.locator("section", { has: page.getByRole("heading", { name: "Odontograma" }) })
    .screenshot({ path: `${PASTA}/08-odontograma.png` });
});

// Painéis analíticos: requerem a coorte sintética carregada (padrão do npm run dev da API) e o
// serviço analítico em execução (services/analitico, porta 8766).
test("figuras da administração (tema escuro) e do tablet", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lord-tema", "escuro"));
  await entrar(page, "admin@lord.dev");
  await page.goto("/auditoria");
  await page.getByRole("heading", { name: "Trilha de auditoria" }).waitFor();
  await page.getByRole("row").nth(1).waitFor();
  await capturar(page, "17-auditoria-escuro");
  await page.getByRole("button", { name: "Sair" }).click();

  // RNF04: a mesma ficha em um tablet na vertical (768 × 1024), no tema claro
  await page.addInitScript(() => localStorage.setItem("lord-tema", "claro"));
  await page.setViewportSize({ width: 768, height: 1024 });
  await entrar(page, "aluna@lord.dev");
  await page.getByRole("link", { name: "Paciente Sintético 005" }).click();
  await page.getByRole("link", { name: /Ficha inicial/ }).first().click();
  await abrirSecao(page, /Exame clínico de DTM/);
  await page.getByText("Dor à palpação muscular e articular").scrollIntoViewIfNeeded();
  await capturar(page, "18-ficha-tablet");
});

test("figuras dos painéis analíticos", async ({ page }) => {
  const cartao = (titulo: string) => page.locator("section", { has: page.getByRole("heading", { name: titulo }) });

  await entrar(page, "coorte@lord.dev");
  // paciente do grupo da placa oclusal que concluiu o tratamento, com efeito próximo ao do grupo
  await page.getByRole("link", { name: "Paciente Coorte C023" }).click();
  await cartao("Evolução clínica").getByRole("img", { name: /Intensidade da dor/ }).waitFor();
  await page.waitForLoadState("networkidle");
  await cartao("Evolução clínica").screenshot({ path: `${PASTA}/12-evolucao-paciente.png` });

  await page.getByRole("button", { name: "Sair" }).click();
  await entrar(page, "pesquisadora@lord.dev");
  await cartao("Variação da dor por tratamento").getByRole("img").waitFor();
  await page.waitForLoadState("networkidle");
  await page.mouse.move(0, 0); // sem dica aberta na figura
  await cartao("Variação da dor por tratamento").screenshot({ path: `${PASTA}/13-painel-coorte.png` });
  await capturar(page, "14-painel-completo", true);
});
