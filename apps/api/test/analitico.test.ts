// Esquema analítico pseudonimizado (LGPD, art. 13): o que o papel lord_analitico enxerga.
import exemplo from "@lord/ficha/exemplos/ficha-inicial.exemplo.json" with { type: "json" };
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Sql } from "postgres";
import { conectar } from "../src/banco";
import { type UsuarioTeste, chamar, criarUsuario, pacienteExemplo, usarContexto } from "./ajuda";

const ctx = usarContexto();
let aluno: UsuarioTeste, professor: UsuarioTeste;
let analitico: Sql;

async function novoPaciente() {
  return (await chamar(ctx, aluno, "POST", "/pacientes", pacienteExemplo())).corpo as { id: string; nome: string };
}

/** Pseudônimo esperado, calculado pelo superusuário (o analista não tem como fazer isso). */
async function pseudonimoDe(pacienteId: string): Promise<string> {
  const [{ p }] = await ctx.admin`select analitico.pseudonimo(${pacienteId}) as p`;
  return p;
}

async function fichaAprovada(pacienteId: string, dados: object, data: string, tipo = "primeira_consulta") {
  const at = (await chamar(ctx, aluno, "POST", `/pacientes/${pacienteId}/atendimentos`, { tipo, data })).corpo;
  await chamar(ctx, aluno, "PUT", `/fichas/${at.ficha.id}`, { dados });
  await chamar(ctx, aluno, "POST", `/fichas/${at.ficha.id}/enviar`);
  await chamar(ctx, professor, "POST", `/fichas/${at.ficha.id}/aprovar`);
  return at.ficha.id as string;
}

beforeAll(async () => {
  [aluno, professor] = await Promise.all([criarUsuario(ctx, "aluno"), criarUsuario(ctx, "professor")]);
  analitico = conectar(inject("urlAnalitico"), { max: 1 });
});

afterAll(async () => {
  await analitico.end();
});

describe("esquema analítico", () => {
  it("não dá acesso às tabelas identificadas nem ao segredo dos pseudônimos", async () => {
    await expect(analitico`select nome from public.paciente`).rejects.toThrow(/permission denied/);
    await expect(analitico`select * from public.ficha`).rejects.toThrow(/permission denied/);
    await expect(analitico`select * from privado.segredo`).rejects.toThrow(/permission denied/);
  });

  it("expõe só fichas aprovadas, com pseudônimo, faixa etária e dias desde o início", async () => {
    const paciente = await novoPaciente();
    await fichaAprovada(paciente.id, exemplo, "2026-08-01");
    await fichaAprovada(paciente.id, { dor: { q16_dor_atual: 1, q17_pior_dor: 3, q18_dor_media: 2 } }, "2026-08-31", "retorno");
    // atendimento com ficha ainda em rascunho não aparece
    await chamar(ctx, aluno, "POST", `/pacientes/${paciente.id}/atendimentos`, { tipo: "retorno", data: "2026-09-15" });

    const pseudo = await pseudonimoDe(paciente.id);
    expect(pseudo).toMatch(/^[0-9a-f]{16}$/);

    const linhas = await analitico`
      select dias_desde_inicio, tipo_ficha, dor_atual, dados_estruturados
      from analitico.ficha where pseudo_id = ${pseudo} order by dias_desde_inicio`;
    expect(linhas.map((l) => [l.dias_desde_inicio, l.tipo_ficha, l.dor_atual])).toEqual([
      [0, "ficha-inicial", 4],
      [30, "ficha-retorno", 1],
    ]);
    expect(linhas[0].dados_estruturados.diagnostico_eixo1.grupo1_muscular).toBe("Ia_dor_miofascial");
    expect(linhas[0].dados_estruturados.categorias_tratamento).toEqual(["orientacoes_autocuidado", "placa_oclusal"]);

    // textos livres (que podem conter nomes e outros identificadores) ficam de fora
    const texto = JSON.stringify(linhas);
    expect(texto).not.toContain(paciente.nome);
    expect(texto).not.toContain("Dipirona");
    expect(texto).not.toContain("queixa_principal");

    const [p] = await analitico`select faixa_etaria_inicio, sexo from analitico.paciente where pseudo_id = ${pseudo}`;
    expect(p).toEqual({ faixa_etaria_inicio: 30, sexo: "F" });
  });

  it("o pseudônimo não é derivável do identificador sem o segredo", async () => {
    const paciente = await novoPaciente();
    const pseudo = await pseudonimoDe(paciente.id);
    const [{ semSegredo }] = await ctx.admin`
      select left(encode(digest(${paciente.id}::text, 'sha256'), 'hex'), 16) as "semSegredo"`;
    expect(pseudo).not.toBe(semSegredo);
    expect(await pseudonimoDe(paciente.id)).toBe(pseudo); // estável
  });

  it("depois de um adendo aprovado, só a versão mais recente é analisada", async () => {
    const paciente = await novoPaciente();
    const v1 = await fichaAprovada(paciente.id, exemplo, "2026-08-01");
    const adendo = (await chamar(ctx, aluno, "POST", `/fichas/${v1}/adendo`)).corpo;
    const corrigido = structuredClone(exemplo);
    corrigido.questionario_dtm.q16_dor_atual = 6;
    await chamar(ctx, aluno, "PUT", `/fichas/${adendo.id}`, { dados: corrigido });
    await chamar(ctx, aluno, "POST", `/fichas/${adendo.id}/enviar`);
    await chamar(ctx, professor, "POST", `/fichas/${adendo.id}/aprovar`);

    const linhas = await analitico`
      select versao, dor_atual from analitico.ficha where pseudo_id = ${await pseudonimoDe(paciente.id)}`;
    expect(linhas).toEqual([{ versao: 2, dor_atual: 6 }]);
  });

  it("tratamentos aparecem com datas relativas ao início", async () => {
    const paciente = await novoPaciente();
    await fichaAprovada(paciente.id, exemplo, "2026-08-01");
    await chamar(ctx, aluno, "POST", `/pacientes/${paciente.id}/tratamentos`, {
      categoria: "placa_oclusal", inicio: "2026-08-15", fim: "2026-10-15",
    });
    const linhas = await analitico`
      select categoria, inicio_dias, fim_dias from analitico.tratamento where pseudo_id = ${await pseudonimoDe(paciente.id)}`;
    expect(linhas).toEqual([{ categoria: "placa_oclusal", inicio_dias: 14, fim_dias: 75 }]);
  });
});
