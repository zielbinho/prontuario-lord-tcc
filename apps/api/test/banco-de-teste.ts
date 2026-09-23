// Sobe um PostgreSQL 17 descartável para a rodada de testes, aplica as migrações e
// repassa as URLs de conexão aos testes (inject).
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { conectar, configurarPapeis, migrar } from "../src/banco";

export const SENHAS = {
  superusuario: "superusuario-teste",
  app: "senha-app-teste",
  analitico: "senha-analitico-teste",
};

async function portaLivre(): Promise<number> {
  return new Promise((resolve) => {
    const servidor = createServer();
    servidor.listen(0, () => {
      const { port } = servidor.address() as { port: number };
      servidor.close(() => resolve(port));
    });
  });
}

declare module "vitest" {
  export interface ProvidedContext {
    urlAdmin: string;
    urlApp: string;
    urlAnalitico: string;
  }
}

export default async function preparar(projeto: TestProject) {
  const pasta = mkdtempSync(join(tmpdir(), "lord-teste-"));
  const porta = await portaLivre();
  const pg = new EmbeddedPostgres({
    databaseDir: pasta, port: porta, user: "postgres", password: SENHAS.superusuario, persistent: false,
    onLog: () => {}, onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("lord");

  const base = `127.0.0.1:${porta}/lord`;
  const urlAdmin = `postgres://postgres:${SENHAS.superusuario}@${base}`;
  const admin = conectar(urlAdmin, { max: 1 });
  await migrar(admin);
  await configurarPapeis(admin, {
    senhaPapelApp: SENHAS.app,
    senhaPapelAnalitico: SENHAS.analitico,
    segredoPseudonimo: "segredo-pseudonimo-teste",
  });
  await admin.end();

  projeto.provide("urlAdmin", urlAdmin);
  projeto.provide("urlApp", `postgres://lord_app:${SENHAS.app}@${base}`);
  projeto.provide("urlAnalitico", `postgres://lord_analitico:${SENHAS.analitico}@${base}`);

  return async () => {
    await pg.stop();
    rmSync(pasta, { recursive: true, force: true });
  };
}
