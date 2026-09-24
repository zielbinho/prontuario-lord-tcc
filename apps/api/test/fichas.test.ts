import exemplo from "@lord/ficha/exemplos/ficha-inicial.exemplo.json" with { type: "json" };
import { beforeAll, describe, expect, it } from "vitest";
import { type UsuarioTeste, chamar, criarUsuario, pacienteExemplo, usarContexto } from "./ajuda";

const ctx = usarContexto();
let aluno: UsuarioTeste, professor: UsuarioTeste;
let pacienteId: string;

beforeAll(async () => {
  [aluno, professor] = await Promise.all([criarUsuario(ctx, "aluno"), criarUsuario(ctx, "professor")]);
  pacienteId = (await chamar(ctx, aluno, "POST", "/pacientes", pacienteExemplo())).corpo.id;
});

async function abrirAtendimento(tipo = "primeira_consulta") {
  const r = await chamar(ctx, aluno, "POST", `/pacientes/${pacienteId}/atendimentos`, { tipo, professor_id: professor.id });
  expect(r.status).toBe(201);
  return r.corpo as { id: string; ficha: { id: string; tipo: string; status: string } };
}

describe("fluxo da ficha", () => {
  it("abrir um atendimento cria a ficha correspondente em rascunho", async () => {
    const inicial = await abrirAtendimento();
    expect(inicial.ficha).toMatchObject({ tipo: "ficha-inicial", status: "rascunho", versao: 1 });
    const retorno = await abrirAtendimento("retorno");
    expect(retorno.ficha.tipo).toBe("ficha-retorno");

    const lista = (await chamar(ctx, aluno, "GET", `/pacientes/${pacienteId}/atendimentos`)).corpo;
    expect(lista.length).toBeGreaterThanOrEqual(2);
    expect(lista[0].fichas[0]).toHaveProperty("status", "rascunho");
  });

  it("rejeita dados fora do esquema com a lista de erros", async () => {
    const { ficha } = await abrirAtendimento();
    const r = await chamar(ctx, aluno, "PUT", `/fichas/${ficha.id}`, {
      dados: { questionario_dtm: { q16_dor_atual: 15 }, campo_inventado: {} },
    });
    expect(r.status).toBe(400);
    expect(r.corpo.detalhes.map((e: { caminho: string }) => e.caminho)).toEqual(
      expect.arrayContaining(["/questionario_dtm/q16_dor_atual"]),
    );
  });

  it("rascunho → revisão → devolvida → revisão → aprovada; a aprovada é imutável", async () => {
    const { ficha } = await abrirAtendimento();
    const url = `/fichas/${ficha.id}`;

    const salvo = await chamar(ctx, aluno, "PUT", url, { dados: { queixa_principal: { texto: "Dor ao mastigar." } } });
    expect(salvo.status).toBe(200);
    expect(salvo.corpo.completude).toBeLessThan(1);
    expect(salvo.corpo.completude_detalhada.faltantes).toContain("plano_tratamento.texto");

    const completa = await chamar(ctx, aluno, "PUT", url, { dados: exemplo });
    expect(completa.corpo.completude).toBe(1);

    expect((await chamar(ctx, aluno, "POST", `${url}/enviar`)).corpo.status).toBe("em_revisao");
    expect((await chamar(ctx, aluno, "PUT", url, { dados: exemplo })).status).toBe(409);

    // só o professor devolve e aprova
    expect((await chamar(ctx, aluno, "POST", `${url}/aprovar`)).status).toBe(403);
    const devolvida = await chamar(ctx, professor, "POST", `${url}/devolver`, { comentario: "Detalhar o uso de medicamentos." });
    expect(devolvida.corpo).toMatchObject({ status: "rascunho", comentario_revisao: "Detalhar o uso de medicamentos." });

    await chamar(ctx, aluno, "POST", `${url}/enviar`);
    const aprovada = await chamar(ctx, professor, "POST", `${url}/aprovar`);
    expect(aprovada.corpo).toMatchObject({ status: "aprovada", aprovado_por: professor.id, comentario_revisao: null });

    expect((await chamar(ctx, professor, "PUT", url, { dados: {} })).status).toBe(409);
    expect((await chamar(ctx, professor, "POST", `${url}/aprovar`)).status).toBe(409);

    // nem o dono das tabelas consegue alterar ou excluir uma ficha aprovada
    await expect(ctx.admin`update ficha set dados = '{}' where id = ${ficha.id}`).rejects.toThrow(/imutável/);
    await expect(ctx.admin`delete from ficha where id = ${ficha.id}`).rejects.toThrow(/não podem ser excluídas/);

    const acoes = (await ctx.admin`select acao from auditoria where entidade_id = ${ficha.id} order by id`).map((a) => a.acao);
    expect(acoes).toEqual(["alterar_ficha", "alterar_ficha", "enviar_ficha_revisao", "devolver_ficha", "enviar_ficha_revisao", "aprovar_ficha"]);
  });

  it("correções em ficha aprovada viram adendo com nova versão, sem apagar a original", async () => {
    const { ficha } = await abrirAtendimento();
    const url = `/fichas/${ficha.id}`;
    await chamar(ctx, aluno, "PUT", url, { dados: exemplo });
    expect((await chamar(ctx, aluno, "POST", `${url}/adendo`)).status).toBe(409); // ainda não aprovada
    await chamar(ctx, aluno, "POST", `${url}/enviar`);
    await chamar(ctx, professor, "POST", `${url}/aprovar`);

    const adendo = await chamar(ctx, aluno, "POST", `${url}/adendo`);
    expect(adendo.status).toBe(201);
    expect(adendo.corpo).toMatchObject({ versao: 2, ficha_anterior_id: ficha.id, status: "rascunho" });
    expect((await chamar(ctx, aluno, "POST", `${url}/adendo`)).status).toBe(409); // já existe versão aberta

    const v2 = (await chamar(ctx, aluno, "GET", `/fichas/${adendo.corpo.id}`)).corpo;
    expect(v2.dados).toEqual(exemplo);
    expect(v2.atendimento).toMatchObject({ paciente_id: pacienteId, tipo: "primeira_consulta", aluno: "Usuário aluno" });
    const versoes = (await chamar(ctx, aluno, "GET", `/fichas/${adendo.corpo.id}/versoes`)).corpo;
    expect(versoes.map((v: { versao: number; status: string }) => [v.versao, v.status])).toEqual([[1, "aprovada"], [2, "rascunho"]]);
  });

  it("as colunas geradas extraem as medidas do documento JSONB", async () => {
    const { ficha } = await abrirAtendimento();
    await chamar(ctx, aluno, "PUT", `/fichas/${ficha.id}`, { dados: exemplo });
    const [linha] = await ctx.admin`
      select dor_atual, pior_dor, dor_media, abertura_max_sem_auxilio from ficha where id = ${ficha.id}`;
    expect(linha).toEqual({ dor_atual: 4, pior_dor: 8, dor_media: 5, abertura_max_sem_auxilio: 41 });

    const { ficha: retorno } = await abrirAtendimento("retorno");
    await chamar(ctx, aluno, "PUT", `/fichas/${retorno.id}`, { dados: { dor: { q16_dor_atual: 2 } } });
    const [r] = await ctx.admin`select dor_atual from ficha where id = ${retorno.id}`;
    expect(r.dor_atual).toBe(2);
  });

  it("a fila de revisão do professor lista as fichas enviadas", async () => {
    const { ficha } = await abrirAtendimento();
    await chamar(ctx, aluno, "POST", `/fichas/${ficha.id}/enviar`);
    const fila = (await chamar(ctx, professor, "GET", "/revisao")).corpo as { id: string }[];
    expect(fila.map((f) => f.id)).toContain(ficha.id);
    expect((await chamar(ctx, aluno, "GET", "/revisao")).status).toBe(403);
  });

  it("valida e grava o odontograma do atendimento", async () => {
    const { id } = await abrirAtendimento();
    const url = `/atendimentos/${id}/odontograma`;
    expect((await chamar(ctx, aluno, "PUT", url, { dados: { "19": { ausente: true } } })).status).toBe(400);
    const dados = { "36": { faces: { O: "restauracao" } }, "48": { ausente: true } };
    expect((await chamar(ctx, aluno, "PUT", url, { dados })).status).toBe(200);
    expect((await chamar(ctx, aluno, "GET", url)).corpo.dados).toEqual(dados);
  });
});
