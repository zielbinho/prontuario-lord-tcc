// Ambiente de DESENVOLVIMENTO: sobe um PostgreSQL local (embedded-postgres, sem instalação),
// aplica as migrações, popula com dados sintéticos e inicia a API em http://localhost:3333.
// Nunca use este script com dados reais.
import EmbeddedPostgres from "embedded-postgres";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { criarApp } from "./app";
import { conectar, configurarPapeis, migrar } from "./banco";
import { ALUNO_COORTE, carregarCoorte } from "./coorte";
import { carregarConfig } from "./config";
import { pararBancoDev } from "./dev-parar";
import { SENHA_DEV, USUARIOS_DEV, semear } from "./semear";

const PASTA = join(dirname(fileURLToPath(import.meta.url)), "..", ".dados-dev");
const PORTA_BANCO = 54330;
const ARQUIVO_SEGREDOS = join(PASTA, "segredos.json");

mkdirSync(PASTA, { recursive: true });
const segredos: Record<string, string> = existsSync(ARQUIVO_SEGREDOS)
  ? JSON.parse(readFileSync(ARQUIVO_SEGREDOS, "utf-8"))
  : Object.fromEntries(["superusuario", "app", "analitico", "criptografia", "pseudonimo"].map((k) => [k, randomBytes(24).toString("hex")]));
writeFileSync(ARQUIVO_SEGREDOS, JSON.stringify(segredos, null, 2));

const pastaBanco = join(PASTA, "pg");
if (await pararBancoDev(pastaBanco)) console.log("Banco de uma sessão anterior estava ativo e foi parado.");
const pg = new EmbeddedPostgres({
  databaseDir: pastaBanco, port: PORTA_BANCO, user: "postgres", password: segredos.superusuario, persistent: true,
  onLog: () => {},
});
const primeiraVez = !existsSync(join(pastaBanco, "PG_VERSION"));
if (primeiraVez) await pg.initialise();
await pg.start();
if (primeiraVez) await pg.createDatabase("lord");

const base = `127.0.0.1:${PORTA_BANCO}/lord`;
const config = carregarConfig({
  ...process.env,
  URL_BANCO: `postgres://lord_app:${segredos.app}@${base}`,
  URL_BANCO_ADMIN: `postgres://postgres:${segredos.superusuario}@${base}`,
  SENHA_PAPEL_APP: segredos.app,
  SENHA_PAPEL_ANALITICO: segredos.analitico,
  CHAVE_CRIPTOGRAFIA: segredos.criptografia,
  SEGREDO_PSEUDONIMO: segredos.pseudonimo,
  COOKIE_SEGURO: "false",
});

const admin = conectar(config.urlBancoAdmin, { max: 2 });
const aplicadas = await migrar(admin);
await configurarPapeis(admin, config);
if (aplicadas.length) console.log(`Migrações aplicadas: ${aplicadas.join(", ")}`);

const sql = conectar(config.urlBanco);
const app = await criarApp({ sql, config, log: process.env.LOG === "1" });
if (await semear(admin, app)) console.log("Banco populado com dados sintéticos.");
// coorte do Experimento D para os painéis analíticos (carregada uma vez só; COORTE=0 pula)
if (process.env.COORTE !== "0") {
  const carregados = await carregarCoorte(admin, app, (feitos, total) => {
    if (feitos % 25 === 0 || feitos === total) console.log(`Coorte sintética: ${feitos}/${total} pacientes`);
  });
  if (carregados) console.log(`Coorte sintética carregada: ${carregados} pacientes (aluno ${ALUNO_COORTE.email}).`);
}
await app.listen({ port: config.porta, host: "127.0.0.1" });

console.log(`
API de desenvolvimento em http://localhost:${config.porta}
Banco: postgres://postgres@${base} (senha em apps/api/.dados-dev/segredos.json)
Usuários (senha "${SENHA_DEV}"):
${[...USUARIOS_DEV, ALUNO_COORTE].map((u) => `  ${u.papel.padEnd(12)} ${u.email}`).join("\n")}
Painéis analíticos: requerem o serviço services/analitico na porta 8766.
`);

const encerrar = async () => {
  await app.close();
  await sql.end();
  await admin.end();
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);
