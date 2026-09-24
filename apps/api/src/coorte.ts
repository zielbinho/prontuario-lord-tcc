// Carrega a coorte sintética do Experimento D (dados/sinteticos/coorte) no banco de DESENVOLVIMENTO.
// Tudo passa pela API (app.inject), como no semear: validação pelo esquema, RLS, revisão e aprovação.
// Os pacientes ficam com um aluno próprio, para não misturar com os pacientes de demonstração.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { gerarHashSenha } from "./autenticacao";
import { SENHA_DEV, chamar, entrar } from "./semear";

export const ALUNO_COORTE = { nome: "Carlos Coorte", email: "coorte@lord.dev", papel: "aluno" } as const;
const ARQUIVO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dados", "sinteticos", "coorte", "coorte.json");

interface PacienteCoorte {
  codigo: string;
  sexo: string;
  idade: number;
  consultas: { data: string; tipo_ficha: "ficha-inicial" | "ficha-retorno"; dados: object }[];
  tratamento: { categoria: string; inicio: string; fim: string | null };
}

/** Devolve quantos pacientes foram carregados (0 se o arquivo não existe ou a coorte já está no banco). */
export async function carregarCoorte(admin: Sql, app: FastifyInstance, aoProgredir?: (feitos: number, total: number) => void): Promise<number> {
  if (!existsSync(ARQUIVO)) return 0;
  const [{ n }] = await admin`select count(*)::int as n from paciente where numero_prontuario like 'COORTE-%'`;
  if (n > 0) return 0;

  await admin`
    insert into usuario (nome, email, senha_hash, papel)
    values (${ALUNO_COORTE.nome}, ${ALUNO_COORTE.email}, ${await gerarHashSenha(SENHA_DEV)}, ${ALUNO_COORTE.papel})
    on conflict (lower(email)) do nothing`;
  const aluno = await entrar(app, ALUNO_COORTE.email);
  const professora = await entrar(app, "professora@lord.dev");
  const [{ id: professoraId }] = await admin`select id from usuario where email = 'professora@lord.dev'`;

  const coorte: PacienteCoorte[] = JSON.parse(readFileSync(ARQUIVO, "utf-8"));
  for (const [i, p] of coorte.entries()) {
    const inicio = p.consultas[0].data;
    const paciente = await chamar(app, aluno, "POST", "/pacientes", {
      numero_prontuario: `COORTE-${p.codigo}`,
      nome: `Paciente Coorte ${p.codigo}`,
      data_nascimento: `${Number(inicio.slice(0, 4)) - p.idade}-01-15`,
      sexo: p.sexo,
    });
    await chamar(app, aluno, "POST", `/pacientes/${paciente.id}/consentimentos`, { tipo: "tcle", versao_termo: "LORD-2026", aceito_em: inicio });
    for (const c of p.consultas) {
      const at = await chamar(app, aluno, "POST", `/pacientes/${paciente.id}/atendimentos`, {
        tipo: c.tipo_ficha === "ficha-inicial" ? "primeira_consulta" : "retorno", data: c.data, professor_id: professoraId,
      });
      await chamar(app, aluno, "PUT", `/fichas/${at.ficha.id}`, { dados: c.dados });
      await chamar(app, aluno, "POST", `/fichas/${at.ficha.id}/enviar`);
      await chamar(app, professora, "POST", `/fichas/${at.ficha.id}/aprovar`);
    }
    await chamar(app, aluno, "POST", `/pacientes/${paciente.id}/tratamentos`, p.tratamento);
    aoProgredir?.(i + 1, coorte.length);
  }
  return coorte.length;
}
