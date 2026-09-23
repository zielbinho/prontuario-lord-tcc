// Popula o banco de DESENVOLVIMENTO com usuários de teste e pacientes sintéticos.
// Tudo passa pela própria API (app.inject), para respeitar as mesmas regras de produção.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { gerarHashSenha } from "./autenticacao";

export const SENHA_DEV = "lord-dev-2026";

export const USUARIOS_DEV = [
  { nome: "Ana Aluna", email: "aluna@lord.dev", papel: "aluno" },
  { nome: "Bruno Aluno", email: "aluno@lord.dev", papel: "aluno" },
  { nome: "Paula Professora", email: "professora@lord.dev", papel: "professor" },
  { nome: "Rita Pesquisadora", email: "pesquisadora@lord.dev", papel: "pesquisador" },
  { nome: "Adm Sistema", email: "admin@lord.dev", papel: "admin" },
] as const;

const PASTA_CASOS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dados", "sinteticos", "casos");

async function entrar(app: FastifyInstance, email: string): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/auth/login", payload: { email, senha: SENHA_DEV } });
  const c = r.cookies.find((x) => x.name === "lord_sessao");
  if (!c) throw new Error(`falha no login de ${email}: ${r.body}`);
  return `lord_sessao=${c.value}`;
}

async function chamar(app: FastifyInstance, cookie: string, method: "POST" | "PUT", url: string, payload?: unknown) {
  const r = await app.inject({ method, url, payload: payload as never, headers: { cookie } });
  if (r.statusCode >= 400) throw new Error(`${method} ${url} -> ${r.statusCode}: ${r.body}`);
  return r.json();
}

/** Cria usuários e até `quantidade` pacientes a partir dos casos sintéticos. Não faz nada se já houver usuários. */
export async function semear(admin: Sql, app: FastifyInstance, quantidade = 12): Promise<boolean> {
  const [{ n }] = await admin`select count(*)::int as n from usuario`;
  if (n > 0) return false;

  const hash = await gerarHashSenha(SENHA_DEV);
  for (const u of USUARIOS_DEV) {
    await admin`insert into usuario (nome, email, senha_hash, papel) values (${u.nome}, ${u.email}, ${hash}, ${u.papel})`;
  }
  const [aluna, aluno, professora] = await Promise.all(
    ["aluna@lord.dev", "aluno@lord.dev", "professora@lord.dev"].map((e) => entrar(app, e)),
  );
  const [{ id: professoraId }] = await admin`select id from usuario where email = 'professora@lord.dev'`;

  const indice = readFileSync(join(PASTA_CASOS, "indice.csv"), "utf-8").trim().split(/\r?\n/).slice(1);
  for (const [i, linha] of indice.slice(0, quantidade).entries()) {
    const [caso, , sexo, idade] = linha.split(",");
    const gabarito = JSON.parse(readFileSync(join(PASTA_CASOS, caso, "gabarito.json"), "utf-8"));
    const cookie = i % 2 === 0 ? aluna : aluno;
    const numero = caso.replace("caso_", "");

    const paciente = await chamar(app, cookie, "POST", "/pacientes", {
      numero_prontuario: `SINT-${numero}`,
      nome: `Paciente Sintético ${numero}`,
      data_nascimento: `${2026 - Number(idade)}-06-15`,
      sexo,
      telefone: `4299999${numero.padStart(4, "0")}`,
      cpf: `000000${numero.padStart(5, "0")}`,
    });
    await chamar(app, cookie, "POST", `/pacientes/${paciente.id}/consentimentos`, {
      tipo: "tcle", versao_termo: "LORD-2026", aceito_em: "2026-08-01",
    });
    const atendimento = await chamar(app, cookie, "POST", `/pacientes/${paciente.id}/atendimentos`, {
      tipo: "primeira_consulta", data: "2026-08-01", professor_id: professoraId,
    });
    await chamar(app, cookie, "PUT", `/fichas/${atendimento.ficha.id}`, { dados: gabarito });

    // variedade de estados para a interface: a maioria aprovada, algumas em revisão e em rascunho
    if (i % 4 !== 3) await chamar(app, cookie, "POST", `/fichas/${atendimento.ficha.id}/enviar`);
    if (i % 4 < 2) await chamar(app, professora, "POST", `/fichas/${atendimento.ficha.id}/aprovar`);
  }
  return true;
}
