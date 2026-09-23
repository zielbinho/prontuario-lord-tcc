// Desliga o PostgreSQL de desenvolvimento. No Windows, encerrar o Node (Ctrl+C no terminal
// integrado, fechar a janela) pode deixar o processo do banco rodando sozinho; o dev.ts chama
// esta função antes de iniciar, e `npm run dev:parar` a executa manualmente.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PASTA_BANCO_DEV = join(dirname(fileURLToPath(import.meta.url)), "..", ".dados-dev", "pg");

async function caminhoPgCtl(): Promise<string> {
  const sistema = { win32: "windows", darwin: "darwin", linux: "linux" }[process.platform as string];
  const pacote = `@embedded-postgres/${sistema}-${process.arch}`;
  const binarios = (await import(pacote)) as { pg_ctl: string };
  return binarios.pg_ctl;
}

/** Para o servidor se houver um em execução na pasta; devolve true se havia algo a parar. */
export async function pararBancoDev(pasta = PASTA_BANCO_DEV): Promise<boolean> {
  if (!existsSync(join(pasta, "postmaster.pid"))) return false;
  try {
    execFileSync(await caminhoPgCtl(), ["stop", "-D", pasta, "-m", "fast", "-w"], { stdio: "ignore" });
    return true;
  } catch {
    // postmaster.pid obsoleto (o processo já não existe): o próprio PostgreSQL o ignora ao iniciar
    return false;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log((await pararBancoDev()) ? "Banco de desenvolvimento parado." : "Nenhum banco de desenvolvimento em execução.");
}
