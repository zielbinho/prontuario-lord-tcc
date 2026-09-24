import { expect, type Page } from "@playwright/test";

export const SENHA = "lord-dev-2026";

export async function entrar(pagina: Page, email: string) {
  await pagina.goto("/login");
  await pagina.getByLabel("E-mail").fill(email);
  await pagina.getByLabel("Senha").fill(SENHA);
  await pagina.getByRole("button", { name: "Entrar" }).click();
  await expect(pagina.getByRole("button", { name: "Sair" })).toBeVisible();
}

export async function sair(pagina: Page) {
  await pagina.getByRole("button", { name: "Sair" }).click();
  await expect(pagina.getByLabel("E-mail")).toBeVisible();
}

/** Campo da ficha pelo caminho no esquema (atributo data-caminho). */
export const campo = (pagina: Page, caminho: string) => pagina.locator(`[data-caminho="${caminho}"]`);

export async function abrirSecao(pagina: Page, titulo: string | RegExp) {
  await pagina.getByRole("navigation", { name: "Seções da ficha" }).getByRole("button", { name: titulo }).click();
}
