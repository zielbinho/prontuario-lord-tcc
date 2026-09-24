import { expect, test } from "@playwright/test";
import { abrirSecao, campo, entrar, sair } from "./ajuda";

test("aluna registra a ficha, professora devolve e depois aprova", async ({ page }) => {
  const sufixo = Date.now().toString().slice(-6);
  const nome = `Paciente E2E ${sufixo}`;

  // --- aluna: cadastro do paciente -----------------------------------------------------------
  await entrar(page, "aluna@lord.dev");
  await page.getByRole("button", { name: "Novo paciente" }).click();
  await page.getByLabel("Nome completo").fill(nome);
  await page.getByLabel("Data de nascimento").fill("1990-04-20");
  await page.getByLabel("Sexo").selectOption("F");
  await page.getByLabel("CPF").fill(`123.${sufixo.slice(0, 3)}.${sufixo.slice(3)}-00`);
  await page.getByRole("button", { name: "Cadastrar paciente" }).click();
  await expect(page.getByRole("heading", { name: nome })).toBeVisible();

  await page.getByRole("button", { name: "Registrar TCLE assinado hoje" }).click();
  await expect(page.getByText("TCLE (LORD-2026)")).toBeVisible();

  // --- abre a primeira consulta ------------------------------------------------------------------
  await page.getByRole("button", { name: "Novo atendimento" }).click();
  await page.getByLabel("Professor(a) supervisor(a)").selectOption({ label: "Paula Professora" });
  await page.getByRole("button", { name: "Abrir ficha" }).click();
  await expect(page.getByRole("heading", { name: /Ficha clínica inicial/ })).toBeVisible();
  const urlFicha = page.url();

  // --- preenchimento ----------------------------------------------------------------------------
  await campo(page, "queixa_principal.texto").getByRole("textbox").fill("Dor ao mastigar do lado direito.");

  await abrirSecao(page, /História médica/);
  const medicamentos = campo(page, "historia_medica.q4_medicamentos");
  await expect(medicamentos).toHaveCount(0); // campo condicional ainda oculto
  await campo(page, "historia_medica.q4_usa_medicamento").getByRole("button", { name: "Sim" }).click();
  await medicamentos.getByRole("textbox").fill("Losartana 50 mg, há dois anos.");
  await campo(page, "historia_medica.q3_alergias").getByRole("textbox").fill("Nega.");

  await abrirSecao(page, /Questionário de dor/);
  await campo(page, "questionario_dtm.q16_dor_atual").getByRole("button", { name: "7", exact: true }).click();
  await expect(campo(page, "questionario_dtm.q16_dor_atual").getByRole("button", { name: "7", exact: true }))
    .toHaveAttribute("aria-pressed", "true");

  await abrirSecao(page, /Exame clínico de DTM/);
  await page.getByRole("group", { name: "Masseter no corpo, direito" }).getByRole("button", { name: "2" }).click();
  // o sítio correspondente no desenho do rosto passa a mostrar a intensidade
  await expect(page.getByRole("button", { name: /Masseter no corpo, direito: 2/ })).toBeVisible();
  await campo(page, "exame_dtm.q39b_abertura_maxima_sem_auxilio_mm").getByRole("spinbutton").fill("41");

  await abrirSecao(page, /Odontograma/);
  await page.getByRole("radio", { name: "Cárie" }).click();
  await page.locator("polygon").filter({ has: page.locator("title", { hasText: /^36 O$/ }) }).click();
  await page.getByRole("button", { name: "Dente 48" }).click();
  await page.getByLabel("Ausente").check();

  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByRole("button", { name: "Salvo" })).toBeVisible();

  // --- os dados persistem após recarregar a página ------------------------------------------------
  await page.reload();
  await abrirSecao(page, /História médica/);
  await expect(campo(page, "historia_medica.q4_medicamentos").getByRole("textbox")).toHaveValue("Losartana 50 mg, há dois anos.");
  await abrirSecao(page, /Exame clínico de DTM/);
  await expect(page.getByRole("button", { name: /Masseter no corpo, direito: 2/ })).toBeVisible();
  await abrirSecao(page, /Odontograma/);
  await expect(page.getByRole("navigation", { name: "Seções da ficha" }).getByText("2 dentes")).toBeVisible();

  // mudar a resposta de controle apaga o campo dependente
  await abrirSecao(page, /História médica/);
  await campo(page, "historia_medica.q4_usa_medicamento").getByRole("button", { name: "Não" }).click();
  await expect(campo(page, "historia_medica.q4_medicamentos")).toHaveCount(0);
  await campo(page, "historia_medica.q4_usa_medicamento").getByRole("button", { name: "Sim" }).click();
  await expect(campo(page, "historia_medica.q4_medicamentos").getByRole("textbox")).toHaveValue("");

  await page.getByRole("button", { name: "Enviar para revisão" }).click();
  await expect(page.getByText("Em revisão", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar rascunho" })).toHaveCount(0);
  await sair(page);

  // --- professora devolve --------------------------------------------------------------------------
  await entrar(page, "professora@lord.dev");
  await expect(page).toHaveURL(/\/revisao$/);
  await page.getByRole("link", { name: nome }).click();
  await page.getByRole("button", { name: "Devolver ao aluno" }).click();
  await page.getByLabel("O que o aluno precisa corrigir?").fill("Informar os medicamentos em uso.");
  await page.getByRole("button", { name: "Devolver com comentário" }).click();
  await expect(page).toHaveURL(/\/revisao$/);
  await sair(page);

  // --- aluna corrige e reenvia -----------------------------------------------------------------------
  await entrar(page, "aluna@lord.dev");
  await page.goto(urlFicha);
  await expect(page.getByText("Informar os medicamentos em uso.")).toBeVisible();
  await abrirSecao(page, /História médica/);
  await campo(page, "historia_medica.q4_medicamentos").getByRole("textbox").fill("Losartana 50 mg, há dois anos.");
  await page.getByRole("button", { name: "Enviar para revisão" }).click();
  await expect(page.getByText("Em revisão", { exact: true })).toBeVisible();
  await sair(page);

  // --- professora aprova --------------------------------------------------------------------------------
  await entrar(page, "professora@lord.dev");
  await page.getByRole("link", { name: nome }).click();
  await page.getByRole("button", { name: "Aprovar ficha" }).click();
  await expect(page).toHaveURL(/\/revisao$/);
  await page.goto(urlFicha);
  await expect(page.getByText("Aprovada", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar adendo" })).toBeVisible();
  await expect(campo(page, "queixa_principal.texto").getByRole("textbox")).toBeDisabled();
});

test("cada papel só chega às próprias telas", async ({ page }) => {
  await entrar(page, "admin@lord.dev");
  await expect(page).toHaveURL(/\/usuarios$/);
  await page.goto("/pacientes");
  await expect(page).toHaveURL(/\/usuarios$/); // redirecionado: administrador não acessa pacientes
  await expect(page.getByRole("link", { name: "Pacientes" })).toHaveCount(0);
  await sair(page);

  await entrar(page, "pesquisadora@lord.dev");
  await page.goto("/pacientes");
  await expect(page).toHaveURL(/\/pesquisa$/);
});
