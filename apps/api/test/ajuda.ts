import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { afterAll, beforeAll, inject } from "vitest";
import { criarApp } from "../src/app";
import type { ServicoAnalitico } from "../src/rotas/analise";
import type { ServicosIA } from "../src/rotas/ia";
import { gerarHashSenha, type Papel } from "../src/autenticacao";
import { conectar } from "../src/banco";
import { carregarConfig } from "../src/config";

export const SENHA_PADRAO = "senha-de-teste-123";

export interface Contexto {
  app: FastifyInstance;
  /** Superusuário: usado só para preparar dados e inspecionar o banco "por baixo" da API. */
  admin: Sql;
  config: ReturnType<typeof carregarConfig>;
}

/** Cria a API ligada ao banco de teste e a encerra ao final do arquivo. */
export function usarContexto(opcoes: { ia?: ServicosIA; analitico?: ServicoAnalitico } = {}): Contexto {
  const ctx = {} as Contexto;
  let sqlApp: Sql;
  beforeAll(async () => {
    ctx.config = carregarConfig({
      URL_BANCO: inject("urlApp"),
      URL_BANCO_ADMIN: inject("urlAdmin"),
      SENHA_PAPEL_APP: "x",
      SENHA_PAPEL_ANALITICO: "x",
      CHAVE_CRIPTOGRAFIA: "chave-de-criptografia-de-teste-com-32+",
      SEGREDO_PSEUDONIMO: "segredo-pseudonimo-teste",
      COOKIE_SEGURO: "false",
    });
    sqlApp = conectar(ctx.config.urlBanco);
    ctx.admin = conectar(ctx.config.urlBancoAdmin, { max: 2 });
    ctx.app = await criarApp({ sql: sqlApp, config: ctx.config, ia: opcoes.ia, analitico: opcoes.analitico });
  });
  afterAll(async () => {
    await ctx.app.close();
    await sqlApp.end();
    await ctx.admin.end();
  });
  return ctx;
}

export interface UsuarioTeste {
  id: string;
  email: string;
  papel: Papel;
  cookie: string;
}

/** Cria um usuário diretamente no banco e faz login pela API, devolvendo o cookie de sessão. */
export async function criarUsuario(ctx: Contexto, papel: Papel, opcoes: { login?: boolean } = {}): Promise<UsuarioTeste> {
  const email = `${papel}-${randomUUID().slice(0, 8)}@teste.uepg.br`;
  const hash = await gerarHashSenha(SENHA_PADRAO);
  const [{ id }] = await ctx.admin`
    insert into usuario (nome, email, senha_hash, papel)
    values (${`Usuário ${papel}`}, ${email}, ${hash}, ${papel}) returning id`;
  let cookie = "";
  if (opcoes.login !== false) cookie = await login(ctx, email, SENHA_PADRAO);
  return { id, email, papel, cookie };
}

export async function login(ctx: Contexto, email: string, senha: string): Promise<string> {
  const r = await ctx.app.inject({ method: "POST", url: "/auth/login", payload: { email, senha } });
  if (r.statusCode !== 200) throw new Error(`login falhou (${r.statusCode}): ${r.body}`);
  const c = r.cookies.find((x) => x.name === "lord_sessao")!;
  return `${c.name}=${c.value}`;
}

type Metodo = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Requisição autenticada: devolve status e corpo já convertido de JSON. */
export async function chamar(ctx: Contexto, u: UsuarioTeste | null, metodo: Metodo, url: string, payload?: unknown) {
  const r = await ctx.app.inject({
    method: metodo,
    url,
    payload: payload as never,
    headers: u ? { cookie: u.cookie } : {},
  });
  return { status: r.statusCode, corpo: r.body ? (r.json() as any) : undefined, cabecalhos: r.headers };
}

export const pacienteExemplo = (sufixo = randomUUID().slice(0, 6)) => ({
  numero_prontuario: `P-${sufixo}`,
  nome: `Paciente Sintético ${sufixo}`,
  data_nascimento: "1988-03-14",
  sexo: "F",
  telefone: "42999990000",
  endereco: "Rua Fictícia, 100 - Ponta Grossa",
  cpf: String(Math.floor(Math.random() * 1e11)).padStart(11, "0"),
});
