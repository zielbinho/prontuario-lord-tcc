import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql, type TransactionSql } from "postgres";

export type Transacao = TransactionSql<Record<string, never>>;

const PASTA_MIGRACOES = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Datas (tipo date) chegam como texto AAAA-MM-DD, igual ao formato da API. */
export function conectar(url: string, opcoes: postgres.Options<Record<string, never>> = {}): Sql {
  return postgres(url, {
    max: 10,
    onnotice: () => {},
    types: { date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x } } as never,
    ...opcoes,
  });
}

/**
 * Executa `fn` numa transação em nome do usuário autenticado. O identificador vai para
 * a configuração local da transação e é lido pelas políticas de Row-Level Security.
 */
export async function comUsuario<T>(sql: Sql, usuarioId: string, fn: (tx: Transacao) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`select set_config('app.usuario_id', ${usuarioId}, true)`;
    return fn(tx as unknown as Transacao);
  })) as T;
}

/** Aplica, em ordem, as migrações SQL ainda não aplicadas. Deve rodar com o dono das tabelas. */
export async function migrar(admin: Sql): Promise<string[]> {
  await admin`create table if not exists migracao (nome text primary key, aplicada_em timestamptz not null default now())`;
  const aplicadas = new Set((await admin<{ nome: string }[]>`select nome from migracao`).map((m) => m.nome));
  const pendentes = readdirSync(PASTA_MIGRACOES).filter((f) => f.endsWith(".sql") && !aplicadas.has(f)).sort();
  for (const arquivo of pendentes) {
    const conteudo = readFileSync(join(PASTA_MIGRACOES, arquivo), "utf-8");
    await admin.begin(async (tx) => {
      await tx.unsafe(conteudo);
      await tx`insert into migracao (nome) values (${arquivo})`;
    });
  }
  return pendentes;
}

const literal = (texto: string) => `'${texto.replace(/'/g, "''")}'`;

/**
 * Define as senhas dos papéis e o segredo de pseudonimização. O segredo só é gravado
 * uma vez: trocá-lo mudaria todos os pseudônimos já exportados.
 */
export async function configurarPapeis(
  admin: Sql,
  opcoes: { senhaPapelApp: string; senhaPapelAnalitico: string; segredoPseudonimo: string },
): Promise<void> {
  await admin.unsafe(`alter role lord_app password ${literal(opcoes.senhaPapelApp)}`);
  await admin.unsafe(`alter role lord_analitico password ${literal(opcoes.senhaPapelAnalitico)}`);
  await admin`
    insert into privado.segredo (nome, valor)
    values ('pseudonimo', convert_to(${opcoes.segredoPseudonimo}, 'UTF8'))
    on conflict (nome) do nothing`;
}
